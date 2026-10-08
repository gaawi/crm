import "server-only";
import { sql, type Tx } from "@/lib/db";
import { nextActionLabel, NEXT_ACTIONS, stageLabel } from "@/lib/constants";
import type { ActivityView, Timeline, TimelineItem } from "@/lib/booking/types";
import type { ActivityKind, CallOutcome, NextAction, OpportunityKind, OpportunityStage } from "@/lib/types";
import { clampLimit } from "@/lib/queries/shared";

/**
 * Activities: calls, WhatsApp messages, meetings, emails logged by hand,
 * notes, and the automatic "status" entries of booking rows. Synced Gmail
 * mail is not stored here; timelines merge both.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kinds that count as reaching out: they move a "To contact" row to "Contacted". */
export const TOUCH_KINDS: ActivityKind[] = ["call", "whatsapp", "meeting", "email"];

/** "(call)" in "To contact → Contacted (call)". */
const REASON: Record<string, string> = { call: "call", whatsapp: "WhatsApp", meeting: "meeting", email: "email" };

interface ActivityRow {
  id: string;
  kind: ActivityKind;
  outcome: CallOutcome | null;
  body: string | null;
  occurredAt: Date;
  createdAt: Date;
  contactId: string | null;
  organizationId: string | null;
  opportunityId: string | null;
}

const activityColumns = () => sql`
  a.id, a.kind, a.outcome, a.body, a.occurred_at, a.created_at, a.contact_id, a.organization_id, a.opportunity_id
`;

export function toActivityView(row: ActivityRow): ActivityView {
  return {
    ...row,
    occurredAt: new Date(row.occurredAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/**
 * Activities linked to ANY of the given ids, newest first. Status entries are
 * included unless `includeStatus` is false; `before` keeps only older ones
 * (paging along an email history). Empty when no id is given.
 */
export async function listActivities(options: {
  opportunityId?: string | null;
  contactId?: string | null;
  organizationId?: string | null;
  includeStatus?: boolean;
  before?: Date | null;
  limit?: number;
}): Promise<ActivityView[]> {
  const ids = [options.opportunityId, options.contactId, options.organizationId];
  if (!ids.some((id) => id && ID.test(id))) return [];
  const rows = await sql<ActivityRow[]>`
    select ${activityColumns()}
      from activities a
     where (false
       ${options.opportunityId ? sql`or a.opportunity_id = ${options.opportunityId}` : sql``}
       ${options.contactId ? sql`or a.contact_id = ${options.contactId}` : sql``}
       ${options.organizationId ? sql`or a.organization_id = ${options.organizationId}` : sql``})
       ${options.includeStatus === false ? sql`and a.kind <> 'status'` : sql``}
       ${options.before ? sql`and a.occurred_at < ${options.before}` : sql``}
     order by a.occurred_at desc, (a.kind = 'status') desc, a.created_at desc, a.id
     limit ${clampLimit(options.limit, 100)}
  `;
  return rows.map(toActivityView);
}

export interface NewActivity {
  kind: ActivityKind;
  /** Calls only (ignored for other kinds). */
  outcome?: CallOutcome | null;
  body?: string | null;
  /** Default now. */
  occurredAt?: Date | null;
  /** A booking row / deal. Its contact and organization are filled in when not given. */
  opportunityId?: string | null;
  /** Its organization is filled in when not given. */
  contactId?: string | null;
  organizationId?: string | null;
  /**
   * Also set a follow-up (only when given): on the opportunity (follow_up_at +
   * next_step), or on the contact (follow_up_at + follow_up_note) when there
   * is no opportunity.
   */
  followUpAt?: string | null;
  nextStep?: string | null;
  /**
   * The opportunity's structured next step: undefined keeps it, null clears
   * it. Without an opportunity it only names the contact's follow-up note
   * (when followUpAt is given and nextStep is empty).
   */
  nextAction?: NextAction | null;
}

export interface AddedActivity {
  activity: ActivityView;
  /** The opportunity's new stage when logging this moved it ("To contact" → "Contacted"). */
  stageChanged: OpportunityStage | null;
}

/**
 * Log an activity. Fills the contact / organization from the opportunity (and
 * the organization from the contact), refreshes the contact's
 * last_contacted_at, and moves an opportunity in "To contact" (lead) to
 * "Contacted" when the activity is a call, WhatsApp, meeting or logged email
 * (with a status entry). One transaction.
 */
export async function addActivity(input: NewActivity): Promise<AddedActivity> {
  return sql.begin((tx) => addActivityTx(tx, input));
}

export async function addActivityTx(tx: Tx, input: NewActivity): Promise<AddedActivity> {
  if (input.nextAction && !NEXT_ACTIONS.some((a) => a.value === input.nextAction)) throw new Error("Unknown next step");
  let contactId = input.contactId || null;
  let organizationId = input.organizationId || null;
  let opportunity: { id: string; stage: OpportunityStage; kind: OpportunityKind } | null = null;

  if (input.opportunityId) {
    const [row] = await tx<{ id: string; stage: OpportunityStage; kind: OpportunityKind; contactId: string | null; organizationId: string | null }[]>`
      select id, stage, kind, contact_id, organization_id from opportunities where id = ${input.opportunityId} for update
    `;
    if (!row) throw new Error("Row not found");
    opportunity = row;
    contactId ??= row.contactId;
    organizationId ??= row.organizationId;
  }
  if (contactId) {
    const [contact] = await tx<{ organizationId: string | null }[]>`select organization_id from contacts where id = ${contactId}`;
    if (!contact) throw new Error("Contact not found");
    organizationId ??= contact.organizationId;
  }
  if (!contactId && !organizationId && !opportunity) throw new Error("Log this on a contact, an organization or a row.");

  const body = input.body?.trim() || null;
  const [inserted] = await tx<ActivityRow[]>`
    insert into activities ${tx({
      kind: input.kind,
      outcome: input.kind === "call" ? (input.outcome ?? null) : null,
      body,
      occurredAt: input.occurredAt ?? new Date(),
      contactId,
      organizationId,
      opportunityId: opportunity?.id ?? null,
    })}
    returning id, kind, outcome, body, occurred_at, created_at, contact_id, organization_id, opportunity_id
  `;

  let stageChanged: OpportunityStage | null = null;
  if (opportunity && opportunity.stage === "lead" && TOUCH_KINDS.includes(input.kind)) {
    await tx`update opportunities set stage = 'contacted' where id = ${opportunity.id}`;
    await tx`
      insert into activities ${tx({
        kind: "status",
        body: `${stageLabel("lead", opportunity.kind)} → ${stageLabel("contacted", opportunity.kind)} (${REASON[input.kind]})`,
        occurredAt: inserted.occurredAt,
        contactId,
        organizationId,
        opportunityId: opportunity.id,
      })}
    `;
    stageChanged = "contacted";
  }

  if (input.followUpAt) {
    if (opportunity) {
      await tx`
        update opportunities
           set follow_up_at = ${input.followUpAt}::date,
               next_step = coalesce(${input.nextStep?.trim() || null}, next_step)
         where id = ${opportunity.id}`;
    } else if (contactId) {
      await tx`
        update contacts
           set follow_up_at = ${input.followUpAt}::date,
               follow_up_note = coalesce(${input.nextStep?.trim() || nextActionLabel(input.nextAction) || null}, follow_up_note)
         where id = ${contactId}`;
    }
  } else if (input.nextStep?.trim() && opportunity) {
    await tx`update opportunities set next_step = ${input.nextStep.trim()} where id = ${opportunity.id}`;
  }
  if (opportunity && input.nextAction !== undefined) {
    await tx`update opportunities set next_action = ${input.nextAction || null} where id = ${opportunity.id}`;
  }

  if (contactId) await tx`select refresh_contact_stats(${[contactId]}::uuid[])`;
  return { activity: toActivityView(inserted), stageChanged };
}

/** A call, with an optional follow-up ("No answer → call again in 2 days"). */
export async function logCall(input: Omit<NewActivity, "kind"> & { outcome: CallOutcome | null }): Promise<AddedActivity> {
  return addActivity({ ...input, kind: "call" });
}

/** Delete one activity (status entries too) and refresh its contact's stats. */
export async function deleteActivity(id: string): Promise<boolean> {
  if (!ID.test(id)) return false;
  return sql.begin(async (tx) => {
    const [row] = await tx<{ contactId: string | null }[]>`delete from activities where id = ${id} returning contact_id`;
    if (!row) return false;
    if (row.contactId) await tx`select refresh_contact_stats(${[row.contactId]}::uuid[])`;
    return true;
  });
}

export async function getActivity(id: string): Promise<ActivityView | null> {
  if (!ID.test(id)) return null;
  const [row] = await sql<ActivityRow[]>`select ${activityColumns()} from activities a where a.id = ${id}`;
  return row ? toActivityView(row) : null;
}

/* Timelines ---------------------------------------------------------------- */

const TIMELINE_LIMIT = 100;

/** Direct mail with the contact (any of their addresses, any role), one row per RFC 822 message, newest first. Bulk mail is left out. */
async function contactEmailItems(contactId: string, limit: number): Promise<TimelineItem[]> {
  const rows = await sql<
    {
      id: string;
      sentAt: Date;
      direction: "inbound" | "outbound";
      subject: string | null;
      snippet: string | null;
      accountId: string;
      accountEmail: string;
      gmailThreadId: string;
    }[]
  >`
    with ids as (
      select distinct mp.message_id
        from contact_emails ce
        join message_participants mp on mp.email = ce.email
       where ce.contact_id = ${contactId}
    ),
    picked as (
      select distinct on (coalesce(m.rfc822_message_id, m.id::text)) m.id
        from ids
        join messages m on m.id = ids.message_id
       where not m.is_automated or m.direction = 'outbound'
       order by coalesce(m.rfc822_message_id, m.id::text), (m.direction = 'inbound'), m.created_at, m.id
    )
    select m.id, m.sent_at, m.direction, m.subject, m.snippet, m.account_id, a.email as account_email, m.gmail_thread_id
      from picked p
      join messages m on m.id = p.id
      join gmail_accounts a on a.id = m.account_id
     order by m.sent_at desc, m.id
     limit ${limit}
  `;
  return rows.map((r) => ({
    type: "email" as const,
    id: r.id,
    at: new Date(r.sentAt).toISOString(),
    direction: r.direction,
    subject: r.subject,
    snippet: r.snippet,
    accountId: r.accountId,
    accountEmail: r.accountEmail,
    gmailThreadId: r.gmailThreadId,
    href: `/mail/t/${encodeURIComponent(r.accountId)}/${encodeURIComponent(r.gmailThreadId)}`,
  }));
}

function merge(activities: ActivityView[], emails: TimelineItem[]): TimelineItem[] {
  const items: TimelineItem[] = [...activities.map((a) => ({ type: "activity" as const, at: a.occurredAt, ...a })), ...emails];
  // Newest first; at the same instant a status entry sits above the call that caused it.
  const statusFirst = (item: TimelineItem) => (item.type === "activity" && item.kind === "status" ? 0 : 1);
  return items
    .sort((x, y) => {
      if (x.at !== y.at) return y.at.localeCompare(x.at);
      if (statusFirst(x) !== statusFirst(y)) return statusFirst(x) - statusFirst(y);
      const cx = x.type === "activity" ? x.createdAt : "";
      const cy = y.type === "activity" ? y.createdAt : "";
      return cy.localeCompare(cx);
    })
    .slice(0, TIMELINE_LIMIT);
}

/**
 * History of a booking row (or any opportunity): its activities and its
 * contact's, plus the contact's emails. Null when the row does not exist.
 */
export async function timelineForRow(rowId: string): Promise<Timeline | null> {
  if (!ID.test(rowId)) return null;
  const [row] = await sql<{ id: string; contactId: string | null; organizationId: string | null }[]>`
    select id, contact_id, organization_id from opportunities where id = ${rowId}
  `;
  if (!row) return null;
  const [activities, emails] = await Promise.all([
    listActivities({ opportunityId: row.id, contactId: row.contactId, limit: TIMELINE_LIMIT }),
    row.contactId ? contactEmailItems(row.contactId, TIMELINE_LIMIT) : Promise.resolve([]),
  ]);
  return { opportunityId: row.id, contactId: row.contactId, organizationId: row.organizationId, items: merge(activities, emails) };
}

/** A contact's activities (on any of their rows too) and emails. Null when the contact does not exist. */
export async function timelineForContact(contactId: string): Promise<Timeline | null> {
  if (!ID.test(contactId)) return null;
  const [contact] = await sql<{ id: string; organizationId: string | null }[]>`select id, organization_id from contacts where id = ${contactId}`;
  if (!contact) return null;
  const [activities, emails] = await Promise.all([
    listActivities({ contactId, limit: TIMELINE_LIMIT }),
    contactEmailItems(contactId, TIMELINE_LIMIT),
  ]);
  return { opportunityId: null, contactId, organizationId: contact.organizationId, items: merge(activities, emails) };
}

/** Every activity of a sheet's rows (and their contacts), oldest first, by row id (CSV export). */
export async function sheetActivities(projectId: string): Promise<Map<string, ActivityView[]>> {
  const rows = await sql<(ActivityRow & { rowId: string })[]>`
    select op.id as row_id, ${activityColumns()}
      from opportunities op
      join projects p on p.id = op.project_id and p.sheet
      join activities a on a.opportunity_id = op.id or (op.contact_id is not null and a.contact_id = op.contact_id)
     where op.project_id = ${projectId}
     order by op.id, a.occurred_at, a.created_at
  `;
  const out = new Map<string, ActivityView[]>();
  for (const { rowId, ...row } of rows) {
    const list = out.get(rowId) ?? [];
    list.push(toActivityView(row));
    out.set(rowId, list);
  }
  return out;
}
