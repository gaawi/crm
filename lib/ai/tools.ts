import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { toISODate } from "@/lib/dates";
import {
  getContact,
  getContactByEmail,
  getContactHistory,
  listContacts,
  updateContact,
} from "@/lib/queries/contacts";
import { getFollowUps } from "@/lib/queries/followups";
import { searchMessages } from "@/lib/queries/messages";
import { listOpportunities } from "@/lib/queries/opportunities";
import {
  getOrganization,
  getOrganizationByName,
  getOrganizationContacts,
  getOrganizationHistory,
  listOrganizations,
} from "@/lib/queries/organizations";
import { getProjectByName, listProjects } from "@/lib/queries/projects";
import { DraftError, proposeEmail } from "@/lib/ai/approvals";
import { readonlyQueriesEnabled, runReadonlyQuery } from "@/lib/ai/readonly-sql";
import type { Contact, ContactStatus, ContactSummary, EmailMessage, Opportunity, OpportunityStage } from "@/lib/types";
import { errorMessage, normalizeTag, truncate } from "@/lib/utils";

/**
 * CRM tools for Claude, defined once and used by both the in-app assistant
 * (/api/assistant) and the MCP endpoint (/api/mcp).
 *
 * Each tool: a snake_case name, a description written for the model, a zod
 * input schema (also rendered to JSON Schema for the API), and a handler that
 * returns JSON-serializable data. Handlers call lib/queries/* and lib/sync/*.
 * Results are compact: truncate long bodies, cap list sizes, ISO dates.
 */

export interface CrmTool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: Schema;
  /** True for tools that change data (update_contact, propose_email). */
  mutates: boolean;
  /**
   * In the in-app chat the change is shown to the owner as a card and only
   * runs after they tap Confirm (MCP clients ask for approval themselves).
   */
  confirm?: boolean;
  /** One-line human description of a pending call, for the confirmation card. */
  summarize?: (input: z.infer<Schema>) => string;
  run: (input: z.infer<Schema>, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  /** 'YYYY-MM-DD' in the owner's timezone. */
  today: string;
  timezone: string;
}

/* ------------------------------------------------------------------------- */
/* Output shaping                                                              */
/* ------------------------------------------------------------------------- */

const STATUSES = ["new", "lead", "active", "inactive", "archived"] as const satisfies readonly ContactStatus[];
const STAGES = ["lead", "contacted", "proposal", "negotiation", "won", "lost"] as const satisfies readonly OpportunityStage[];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, "Expected an id from a previous tool result");

/** "2026-09-21 15:04" in the owner's timezone. */
function stamp(date: Date | null | undefined, timezone: string): string | null {
  if (!date) return null;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${toISODate(date, timezone)} ${time}`;
}

function contactOut(c: ContactSummary, tz: string) {
  return {
    id: c.id,
    name: c.name,
    emails: c.emails,
    organization: c.organization?.name ?? null,
    organization_id: c.organization?.id ?? null,
    role: c.role,
    status: c.status,
    tags: c.tags,
    projects: c.projects.map((p) => p.name),
    last_contacted: stamp(c.lastContactedAt, tz),
    last_email_from_them: stamp(c.lastInboundAt, tz),
    last_email_from_me: stamp(c.lastOutboundAt, tz),
    follow_up_date: c.followUpAt,
    follow_up_note: c.followUpNote,
    message_count: c.messageCount,
    url: `/contacts/${c.id}`,
  };
}

function messageOut(m: EmailMessage, tz: string, bodyChars: number) {
  return {
    id: m.id,
    date: stamp(m.sentAt, tz),
    direction: m.direction === "outbound" ? "sent by me" : "received",
    from: m.from ? (m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email) : null,
    to: m.to.map((a) => a.email),
    cc: m.cc.length ? m.cc.map((a) => a.email) : undefined,
    subject: m.subject,
    body: bodyChars > 0 ? truncate(m.bodyText || m.snippet || "", bodyChars) : undefined,
    snippet: bodyChars > 0 ? undefined : m.snippet,
    automated: m.isAutomated || undefined,
    attachments: m.attachments.length ? m.attachments.map((a) => a.filename) : undefined,
    gmail_accounts: m.accounts,
    gmail_url: m.gmailUrl,
  };
}

function opportunityOut(o: Opportunity) {
  return {
    id: o.id,
    title: o.title,
    stage: o.stage,
    contact: o.contact?.displayName ?? null,
    contact_id: o.contact?.id ?? null,
    organization: o.organization?.name ?? null,
    project: o.project?.name ?? null,
    value: o.value ? `${o.value} ${o.currency}` : null,
    follow_up_date: o.followUpAt,
    next_step: o.nextStep,
    notes: o.notes ? truncate(o.notes, 500) : null,
    closed_at: o.closedAt ? o.closedAt.toISOString().slice(0, 10) : null,
  };
}

/** Resolve a contact from id / email / name. Returns the contact or candidates. */
async function resolveContact(input: {
  contact_id?: string;
  email?: string;
  name?: string;
}): Promise<{ contact: Contact } | { candidates: ContactSummary[] } | { error: string }> {
  if (input.contact_id) {
    const contact = await getContact(input.contact_id);
    return contact ? { contact } : { error: `No contact with id ${input.contact_id}` };
  }
  if (input.email) {
    const contact = await getContactByEmail(input.email);
    return contact ? { contact } : { error: `No contact with address ${input.email}` };
  }
  if (input.name) {
    const { contacts } = await listContacts({ q: input.name, status: "all", limit: 8 });
    const exact = contacts.filter((c) => c.name?.toLowerCase() === input.name!.trim().toLowerCase());
    const pick = exact.length === 1 ? exact[0] : contacts.length === 1 ? contacts[0] : null;
    if (pick) {
      const contact = await getContact(pick.id);
      if (contact) return { contact };
    }
    if (!contacts.length) return { error: `No contact matches "${input.name}"` };
    return { candidates: contacts };
  }
  return { error: "Give contact_id, email or name" };
}

async function resolveOrganizationId(input: { organization_id?: string; name?: string }) {
  if (input.organization_id) return (await getOrganization(input.organization_id)) ? { id: input.organization_id } : { error: "No such organization" };
  if (!input.name) return { error: "Give organization_id or name" };
  const exact = await getOrganizationByName(input.name);
  if (exact) return { id: exact.id };
  const matches = await listOrganizations({ q: input.name, limit: 8 });
  if (matches.length === 1) return { id: matches[0].id };
  if (!matches.length) return { error: `No organization matches "${input.name}"` };
  return { candidates: matches.map((o) => ({ id: o.id, name: o.name, domains: o.domains, contacts: o.contactCount })) };
}

async function projectIdByName(name: string): Promise<string> {
  const project = await getProjectByName(name);
  if (!project) {
    const all = await listProjects({ includeArchived: true });
    throw new Error(`Unknown project "${name}". Projects: ${all.map((p) => p.name).join(", ")}`);
  }
  return project.id;
}

/* ------------------------------------------------------------------------- */
/* Tools                                                                        */
/* ------------------------------------------------------------------------- */

function tool<S extends z.ZodType>(definition: CrmTool<S>): CrmTool {
  return definition as unknown as CrmTool;
}

const searchContacts = tool({
  name: "search_contacts",
  description:
    "Find contacts. Filters combine with AND: free-text query (matches name, any email address, organization, role, tags), project name, tag, status, organization name. Returns profile fields plus last-contact dates and follow-up dates. Archived contacts are excluded unless status is 'archived' or 'all'.",
  mutates: false,
  inputSchema: z.object({
    query: z.string().optional().describe("Free text, e.g. 'curator', 'moma.org', 'Maria'"),
    project: z.string().optional().describe("Project name, e.g. 'Grants'"),
    tag: z.string().optional(),
    status: z.enum([...STATUSES, "all"]).optional(),
    organization: z.string().optional().describe("Organization name"),
    sort: z.enum(["last_contacted", "name", "created", "follow_up"]).optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Default 25"),
  }),
  async run(input, ctx) {
    let organizationId: string | undefined;
    if (input.organization) {
      const org = await resolveOrganizationId({ name: input.organization });
      if ("error" in org) return { error: org.error };
      if ("candidates" in org) return { note: "Several organizations match; pick one and retry", organizations: org.candidates };
      organizationId = org.id;
    }
    const { contacts, total } = await listContacts({
      q: input.query,
      projectId: input.project ? await projectIdByName(input.project) : undefined,
      tag: input.tag,
      status: input.status,
      organizationId,
      sort: input.sort,
      limit: input.limit ?? 25,
    });
    return { total, returned: contacts.length, contacts: contacts.map((c) => contactOut(c, ctx.timezone)) };
  },
});

const getContactTool = tool({
  name: "get_contact",
  description:
    "Full profile of one contact (by contact_id, email address, or name): addresses, organization, role, status, tags, projects, notes, follow-up, last contact dates in each direction, opportunities, and the 10 most recent emails (snippets). If a name matches several people, returns candidates instead.",
  mutates: false,
  inputSchema: z.object({
    contact_id: uuid.optional(),
    email: z.string().optional(),
    name: z.string().optional(),
  }),
  async run(input, ctx) {
    const resolved = await resolveContact(input);
    if ("error" in resolved) return resolved;
    if ("candidates" in resolved) {
      return { note: "Several contacts match; ask which one or retry with contact_id", candidates: resolved.candidates.map((c) => contactOut(c, ctx.timezone)) };
    }
    const c = resolved.contact;
    const [recent, opportunities] = await Promise.all([
      getContactHistory(c.id, { limit: 10 }),
      listOpportunities({ contactId: c.id, includeClosed: true }),
    ]);
    return {
      ...contactOut(c, ctx.timezone),
      notes: c.notes,
      source: c.source === "gmail" ? "auto-created from email" : "added manually",
      created: c.createdAt.toISOString().slice(0, 10),
      opportunities: opportunities.map(opportunityOut),
      recent_emails: recent.map((m) => messageOut(m, ctx.timezone, 0)),
    };
  },
});

const getCorrespondence = tool({
  name: "get_correspondence",
  description:
    "Complete email history with a contact (all their addresses, across every connected Gmail account) or with an organization (its contacts plus anyone at its email domains), newest first, with message bodies (quoted replies stripped). Use `before` (a date from the last result) to page back, and `query` to filter by full-text search.",
  mutates: false,
  inputSchema: z.object({
    contact_id: uuid.optional(),
    organization_id: uuid.optional(),
    query: z.string().optional(),
    before: z.string().optional().describe("Only emails before this date/time (YYYY-MM-DD or ISO)"),
    limit: z.number().int().min(1).max(50).optional().describe("Default 20"),
    body_chars: z.number().int().min(0).max(8000).optional().describe("Characters of body per email, default 1500; 0 = snippets only"),
  }),
  async run(input, ctx) {
    if (!input.contact_id && !input.organization_id) return { error: "Give contact_id or organization_id (use search_contacts / get_organization first)" };
    const before = input.before ? new Date(input.before) : undefined;
    if (before && Number.isNaN(before.getTime())) return { error: "Invalid before date" };
    const options = { limit: input.limit ?? 20, before, q: input.query };
    const messages = input.contact_id
      ? await getContactHistory(input.contact_id, options)
      : await getOrganizationHistory(input.organization_id!, options);
    return {
      returned: messages.length,
      oldest_returned: messages.at(-1) ? messages.at(-1)!.sentAt.toISOString() : null,
      emails: messages.map((m) => messageOut(m, ctx.timezone, input.body_chars ?? 1500)),
    };
  },
});

const searchEmails = tool({
  name: "search_emails",
  description:
    "Full-text search over every synced email (subject, sender, body; English stemming, supports \"quoted phrases\", OR, and -exclusions). Filter by date range, direction, or connected account. Newsletters/notifications are excluded unless include_automated is true. Each hit lists the CRM contacts involved.",
  mutates: false,
  inputSchema: z.object({
    query: z.string().optional().describe("e.g. 'grant application', '\"artist talk\" OR residency'"),
    since: isoDate.optional(),
    until: isoDate.optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    account_email: z.string().optional().describe("Only one connected Gmail account"),
    include_automated: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional().describe("Default 20"),
  }),
  async run(input, ctx) {
    if (!input.query && !input.since && !input.until) return { error: "Give a query or a date range" };
    let accountId: string | undefined;
    if (input.account_email) {
      const [row] = await sql<{ id: string }[]>`select id from gmail_accounts where email = ${input.account_email.toLowerCase()}`;
      if (!row) return { error: `Not a connected account: ${input.account_email}` };
      accountId = row.id;
    }
    const hits = await searchMessages({
      q: input.query,
      since: input.since ? new Date(`${input.since}T00:00:00Z`) : undefined,
      until: input.until ? new Date(`${input.until}T23:59:59Z`) : undefined,
      direction: input.direction,
      accountId,
      includeAutomated: input.include_automated,
      limit: input.limit ?? 20,
    });
    return {
      returned: hits.length,
      emails: hits.map((h) => ({
        ...messageOut(h, ctx.timezone, 400),
        contacts: h.contacts.map((c) => ({ id: c.id, name: c.displayName })),
      })),
    };
  },
});

const listFollowUps = tool({
  name: "list_follow_ups",
  description:
    "Who needs following up: (1) contacts whose follow-up date is due (overdue first), (2) people who emailed last and are waiting for my reply, (3) people I emailed who have not answered for at least `awaiting_days` days, (4) open opportunities with a due follow-up date. Only conversations from the last `lookback_days` days count for (2) and (3). Items the owner marked done are excluded.",
  mutates: false,
  inputSchema: z.object({
    horizon_days: z.number().int().min(0).max(90).optional().describe("Also include follow-up dates up to N days ahead (default 0 = due today or earlier)"),
    awaiting_days: z.number().int().min(1).max(90).optional().describe("Default 7"),
    lookback_days: z.number().int().min(7).max(730).optional().describe("Default 90"),
    limit: z.number().int().min(1).max(100).optional().describe("Per list, default 30"),
  }),
  async run(input, ctx) {
    const lists = await getFollowUps({
      today: ctx.today,
      horizonDays: input.horizon_days,
      awaitingDays: input.awaiting_days,
      lookbackDays: input.lookback_days,
      limit: input.limit ?? 30,
    });
    const brief = (c: ContactSummary) => {
      const full = contactOut(c, ctx.timezone);
      return {
        id: full.id,
        name: c.displayName,
        organization: full.organization,
        projects: full.projects,
        follow_up_date: full.follow_up_date,
        follow_up_note: full.follow_up_note,
        last_email_from_them: full.last_email_from_them,
        last_email_from_me: full.last_email_from_me,
        url: full.url,
      };
    };
    return {
      today: ctx.today,
      follow_ups_due: lists.due.map(brief),
      waiting_for_my_reply: lists.needsReply.map(brief),
      no_answer_to_my_email: lists.awaitingReply.map(brief),
      opportunities_due: lists.opportunities.map(opportunityOut),
    };
  },
});

const getOrganizationTool = tool({
  name: "get_organization",
  description:
    "One organization (by organization_id or name): domains, notes, its contacts with last-contact dates, its opportunities, and the 10 most recent emails with anyone there. With no argument, lists organizations by most recent contact. Use get_correspondence with organization_id for the full history with bodies.",
  mutates: false,
  inputSchema: z.object({
    organization_id: uuid.optional(),
    name: z.string().optional(),
  }),
  async run(input, ctx) {
    if (!input.organization_id && !input.name) {
      const orgs = await listOrganizations({ limit: 50 });
      return {
        organizations: orgs.map((o) => ({ id: o.id, name: o.name, domains: o.domains, contacts: o.contactCount, last_contacted: stamp(o.lastContactedAt, ctx.timezone) })),
      };
    }
    const resolved = await resolveOrganizationId(input);
    if ("error" in resolved) return { error: resolved.error };
    if ("candidates" in resolved) return { note: "Several organizations match", candidates: resolved.candidates };
    const org = (await getOrganization(resolved.id))!;
    const [contacts, opportunities, recent] = await Promise.all([
      getOrganizationContacts(org.id),
      listOpportunities({ organizationId: org.id, includeClosed: true }),
      getOrganizationHistory(org.id, { limit: 10 }),
    ]);
    return {
      id: org.id,
      name: org.name,
      domains: org.domains,
      website: org.website,
      tags: org.tags,
      notes: org.notes,
      last_contacted: stamp(org.lastContactedAt, ctx.timezone),
      contacts: contacts.map((c) => contactOut(c, ctx.timezone)),
      opportunities: opportunities.map(opportunityOut),
      recent_emails: recent.map((m) => messageOut(m, ctx.timezone, 0)),
      url: `/organizations/${org.id}`,
    };
  },
});

const listOpportunitiesTool = tool({
  name: "list_opportunities",
  description: "Pipeline opportunities (bookings, grants, press, sales...). Filter by stage, project name, contact, organization. Open stages only unless include_closed or stage won/lost.",
  mutates: false,
  inputSchema: z.object({
    stage: z.enum(STAGES).optional(),
    project: z.string().optional(),
    contact_id: uuid.optional(),
    organization_id: uuid.optional(),
    include_closed: z.boolean().optional(),
  }),
  async run(input) {
    const opportunities = await listOpportunities({
      stage: input.stage,
      projectId: input.project ? await projectIdByName(input.project) : undefined,
      contactId: input.contact_id,
      organizationId: input.organization_id,
      includeClosed: input.include_closed,
    });
    return { returned: opportunities.length, opportunities: opportunities.map(opportunityOut) };
  },
});

const listProjectsTool = tool({
  name: "list_projects",
  description: "All projects (e.g. CreArtBox, ADAR, Personal, Booking, Press, Grants) with member and open-opportunity counts.",
  mutates: false,
  inputSchema: z.object({}),
  async run() {
    const projects = await listProjects({ includeArchived: true });
    return {
      projects: projects.map((p) => ({ id: p.id, name: p.name, description: p.description, archived: p.archived, people: p.contactCount, open_opportunities: p.openOpportunityCount })),
    };
  },
});

const findPeopleForProject = tool({
  name: "find_people_for_project",
  description:
    "People connected to a project: (1) contacts assigned to the project, and (2) other people whose emails mention the project name or the given keywords (e.g. for 'Grants': 'grant', 'funding', 'application'), ranked by how often and how recently. Use this to find people interested in a project.",
  mutates: false,
  inputSchema: z.object({
    project: z.string().describe("Project name"),
    keywords: z.array(z.string()).max(10).optional().describe("Extra search terms that signal interest"),
    since: isoDate.optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Default 30 per list"),
  }),
  async run(input, ctx) {
    const project = await getProjectByName(input.project);
    const limit = input.limit ?? 30;
    const members = project ? (await listContacts({ projectId: project.id, limit })).contacts : [];
    const terms = [input.project, ...(input.keywords ?? [])].map((t) => (t.includes(" ") ? `"${t.replace(/"/g, "")}"` : t));
    const hits = await searchMessages({
      q: terms.join(" OR "),
      since: input.since ? new Date(`${input.since}T00:00:00Z`) : undefined,
      limit: 200,
    });
    const memberIds = new Set(members.map((m) => m.id));
    const mentions = new Map<string, { id: string; name: string; emails: number; latest: string | null; subjects: string[] }>();
    for (const hit of hits) {
      for (const c of hit.contacts) {
        if (memberIds.has(c.id)) continue;
        const entry = mentions.get(c.id) ?? { id: c.id, name: c.displayName, emails: 0, latest: null, subjects: [] };
        entry.emails++;
        const when = stamp(hit.sentAt, ctx.timezone);
        if (!entry.latest || (when && when > entry.latest)) entry.latest = when;
        if (hit.subject && entry.subjects.length < 3 && !entry.subjects.includes(hit.subject)) entry.subjects.push(hit.subject);
        mentions.set(c.id, entry);
      }
    }
    return {
      project: project ? { id: project.id, name: project.name } : `No project named "${input.project}" (searched emails only)`,
      members: members.map((c) => contactOut(c, ctx.timezone)),
      mentioned_in_email: [...mentions.values()]
        .sort((a, b) => b.emails - a.emails || (b.latest ?? "").localeCompare(a.latest ?? ""))
        .slice(0, limit),
    };
  },
});

const SCHEMA_SUMMARY = `Tables (Postgres):
gmail_accounts(id, email, display_name, status, backfill_status, last_synced_at, created_at)
organizations(id, name, domains text[], website, notes, tags text[], created_at)
projects(id, name, color, description, archived)
contacts(id, name, organization_id, role, notes, tags text[], status ['new','lead','active','inactive','archived'], follow_up_at date, follow_up_note, source ['manual','gmail'], last_contacted_at, last_inbound_at, last_outbound_at, message_count, created_at)
contact_emails(email PK lower-case, contact_id, is_primary)
contact_projects(contact_id, project_id)
messages(id, account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, direction ['inbound','outbound'], from_email, from_name, subject, snippet, body_text, sent_at timestamptz, label_ids text[], is_automated, has_attachments, search tsvector)
message_participants(message_id, role ['from','to','cc','bcc','reply_to'], email, name)
opportunities(id, title, stage ['lead','contacted','proposal','negotiation','won','lost'], contact_id, organization_id, project_id, value numeric, currency, follow_up_at date, next_step, notes, closed_at, created_at)
A contact's emails: join contact_emails ce → message_participants mp on mp.email = ce.email → messages m on m.id = mp.message_id. The same email seen by two accounts has two rows with the same rfc822_message_id — use count(distinct coalesce(m.rfc822_message_id, m.id::text)).`;

const queryDatabase = tool({
  name: "query_database",
  description: `Run one read-only SQL SELECT against the CRM database for questions the other tools cannot answer (counts, groupings, time series...). Max 200 rows, 5 s timeout. ${SCHEMA_SUMMARY}`,
  mutates: false,
  inputSchema: z.object({
    sql: z.string().min(1).max(8000).describe("A single SELECT (or WITH ... SELECT) statement"),
  }),
  async run(input) {
    const { rows, truncated } = await runReadonlyQuery(input.sql);
    return { row_count: rows.length, truncated, rows };
  },
});

const updateContactTool = tool({
  name: "update_contact",
  description:
    "Change a contact: set or clear the follow-up date and note, change status, add/remove tags, add/remove projects (by name), or append a line to the notes. Only do this when the owner asked for it. In the app the owner confirms the change with one tap before it is applied — tell them what you proposed.",
  mutates: true,
  confirm: true,
  summarize(input) {
    const parts: string[] = [];
    if (input.follow_up_date !== undefined) parts.push(input.follow_up_date ? `follow up on ${input.follow_up_date}` : "clear the follow-up");
    if (input.follow_up_note) parts.push(`note "${input.follow_up_note}"`);
    if (input.status) parts.push(`status → ${input.status}`);
    if (input.add_tags?.length) parts.push(`add tags ${input.add_tags.join(", ")}`);
    if (input.remove_tags?.length) parts.push(`remove tags ${input.remove_tags.join(", ")}`);
    if (input.add_projects?.length) parts.push(`add to ${input.add_projects.join(", ")}`);
    if (input.remove_projects?.length) parts.push(`remove from ${input.remove_projects.join(", ")}`);
    if (input.append_note) parts.push(`add note "${truncate(input.append_note, 80)}"`);
    return parts.join(" · ") || "no changes";
  },
  inputSchema: z.object({
    contact_id: uuid,
    follow_up_date: isoDate.nullable().optional().describe("YYYY-MM-DD, or null to clear"),
    follow_up_note: z.string().max(500).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    add_tags: z.array(z.string()).max(20).optional(),
    remove_tags: z.array(z.string()).max(20).optional(),
    add_projects: z.array(z.string()).max(10).optional(),
    remove_projects: z.array(z.string()).max(10).optional(),
    append_note: z.string().max(4000).optional(),
  }),
  async run(input, ctx) {
    const contact = await getContact(input.contact_id);
    if (!contact) return { error: "No such contact" };
    const patch: Parameters<typeof updateContact>[1] = {};
    if (input.follow_up_date !== undefined) patch.followUpAt = input.follow_up_date;
    if (input.follow_up_note !== undefined) patch.followUpNote = input.follow_up_note;
    if (input.status) patch.status = input.status;
    if (input.add_tags || input.remove_tags) {
      const remove = new Set((input.remove_tags ?? []).map(normalizeTag));
      patch.tags = [...contact.tags, ...(input.add_tags ?? [])].filter((t) => !remove.has(normalizeTag(t)));
    }
    if (input.add_projects || input.remove_projects) {
      const ids = new Set(contact.projects.map((p) => p.id));
      for (const name of input.add_projects ?? []) ids.add(await projectIdByName(name));
      for (const name of input.remove_projects ?? []) ids.delete(await projectIdByName(name));
      patch.projectIds = [...ids];
    }
    if (input.append_note) {
      const line = `${ctx.today}: ${input.append_note.trim()}`;
      patch.notes = contact.notes ? `${contact.notes}\n\n${line}` : line;
    }
    await updateContact(contact.id, patch);
    const updated = await getContact(contact.id);
    return { updated: true, contact: updated ? contactOut(updated, ctx.timezone) : null };
  },
});

const proposeEmailTool = tool({
  name: "propose_email",
  description:
    "Put an email in the owner's approval queue (it is also saved as a draft in the right Gmail account). It is NEVER sent by you: the owner approves and sends it, edits it, or asks you to revise it in Approvals. Use it when the owner asks you to prepare/draft/write an email. Recipients must be the contact's addresses or people already in the replied thread. To continue a conversation pass reply_to_message_id (an email id from get_correspondence).",
  mutates: true,
  inputSchema: z.object({
    contact_id: uuid.optional().describe("Recipient contact (their primary address is used when `to` is empty)"),
    to: z.array(z.string()).max(20).optional(),
    cc: z.array(z.string()).max(20).optional(),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20000).describe("Plain text, greeting to sign-off"),
    reply_to_message_id: uuid.optional(),
    purpose: z.enum(["reply", "follow_up", "nudge", "outreach", "other"]).optional(),
    rationale: z.string().max(300).optional().describe("One sentence for the owner: why this email, why now"),
    account_email: z.string().optional().describe("Connected account to send from (default: the one that last corresponded)"),
  }),
  async run(input) {
    let accountId: string | null = null;
    if (input.account_email) {
      const [row] = await sql<{ id: string }[]>`select id from gmail_accounts where email = ${input.account_email.toLowerCase()} and status = 'active'`;
      if (!row) return { error: `Not an active connected account: ${input.account_email}` };
      accountId = row.id;
    }
    try {
      const draft = await proposeEmail({
        contactId: input.contact_id ?? null,
        accountId,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        body: input.body,
        replyToMessageId: input.reply_to_message_id ?? null,
        purpose: input.purpose,
        rationale: input.rationale,
        origin: "assistant",
        restrictRecipients: true,
      });
      if (!draft) return { error: "There is already an open proposal for this contact in Approvals." };
      return {
        queued_for_approval: true,
        from_account: draft.accountEmail,
        to: draft.to,
        saved_in_gmail_drafts: Boolean(draft.gmailDraftId),
        approvals_url: "/approvals",
      };
    } catch (error) {
      if (error instanceof DraftError) return { error: error.message };
      throw error;
    }
  },
});

const TOOLS: CrmTool[] = [
  searchContacts,
  getContactTool,
  getCorrespondence,
  searchEmails,
  listFollowUps,
  getOrganizationTool,
  listOpportunitiesTool,
  listProjectsTool,
  findPeopleForProject,
  queryDatabase,
  updateContactTool,
  proposeEmailTool,
];

/** All tools, in a stable order (the order is part of the prompt-cache prefix). */
export function getCrmTools(): CrmTool[] {
  // Free-form SQL needs the SELECT-only database role (fails closed without it).
  return readonlyQueriesEnabled() ? TOOLS : TOOLS.filter((t) => t.name !== "query_database");
}

/** JSON Schema (draft 2020-12, additionalProperties: false) for a tool's input. */
export function toolInputJsonSchema(tool: CrmTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.inputSchema, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  schema.additionalProperties = false;
  return schema;
}

/** Short present-tense label for the UI, e.g. "Searching emails". */
export function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    search_contacts: "Searching contacts",
    get_contact: "Reading contact",
    get_correspondence: "Reading email history",
    search_emails: "Searching emails",
    list_follow_ups: "Checking follow-ups",
    get_organization: "Reading organization",
    list_opportunities: "Checking the pipeline",
    list_projects: "Listing projects",
    find_people_for_project: "Finding people for the project",
    query_database: "Querying the database",
    update_contact: "Preparing a change",
    propose_email: "Preparing an email for approval",
  };
  return labels[name] ?? name;
}

/**
 * Validate input with the tool's schema and run it. Never throws: returns
 * { ok: false, error } for unknown tools, invalid input or handler errors.
 */
export async function runCrmTool(
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) return { ok: false, error: `Unknown tool ${name}` };
  const parsed = found.inputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` };
  }
  try {
    const result = await found.run(parsed.data, context);
    if (result && typeof result === "object" && "error" in result && Object.keys(result).length === 1) {
      return { ok: false, error: String((result as { error: unknown }).error) };
    }
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
