import "server-only";
import { sql, type Tx } from "@/lib/db";
import type { Contact, ContactStatus, ContactSummary, EmailMessage } from "@/lib/types";
import { isValidEmail, normalizeEmail, normalizeTag } from "@/lib/utils";
import { findOrCreateOrganization } from "@/lib/queries/organizations";
import {
  clampLimit,
  contactSummaryColumns,
  contactSummaryJoins,
  likePattern,
  messageColumns,
  toEmailMessage,
} from "@/lib/queries/shared";

/**
 * Contact reads/writes. All functions use `sql` from lib/db (camelCase results).
 * Contact summaries always include emails (primary first), organization ref,
 * projects (ordered by sort_order) and the denormalized history columns.
 */

export interface ContactFilters {
  /** Matches name, any address, organization name, role, tags (case-insensitive substring). */
  q?: string;
  projectId?: string;
  tag?: string;
  /** Default: every status except archived. "all" includes archived. */
  status?: ContactStatus | "all";
  organizationId?: string;
  sort?: "last_contacted" | "name" | "created" | "follow_up";
  limit?: number;
  offset?: number;
}

export async function listContacts(filters: ContactFilters = {}): Promise<{ contacts: ContactSummary[]; total: number }> {
  const q = filters.q?.trim();
  const pattern = q ? likePattern(q) : null;
  const limit = clampLimit(filters.limit, 100);
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  const status = filters.status;

  const order = (() => {
    switch (filters.sort) {
      case "name":
        return sql`lower(coalesce(nullif(btrim(c.name), ''), e.emails[1], '')) asc, c.id`;
      case "created":
        return sql`c.created_at desc, c.id`;
      case "follow_up":
        return sql`c.follow_up_at asc nulls last, c.last_contacted_at desc nulls last, c.id`;
      default:
        return sql`c.last_contacted_at desc nulls last, c.created_at desc, c.id`;
    }
  })();

  const rows = await sql<(ContactSummary & { totalCount: number })[]>`
    select ${contactSummaryColumns()}, count(*) over ()::int as total_count
      from contacts c
      ${contactSummaryJoins()}
     where true
       ${status === "all" ? sql`` : status ? sql`and c.status = ${status}` : sql`and c.status <> 'archived'`}
       ${
         pattern
           ? sql`and (
               c.name ilike ${pattern}
               or c.role ilike ${pattern}
               or o.name ilike ${pattern}
               or exists (select 1 from contact_emails ce2 where ce2.contact_id = c.id and ce2.email ilike ${pattern})
               or exists (select 1 from unnest(c.tags) t where t ilike ${pattern})
             )`
           : sql``
       }
       ${
         filters.projectId
           ? sql`and exists (select 1 from contact_projects cp2 where cp2.contact_id = c.id and cp2.project_id = ${filters.projectId})`
           : sql``
       }
       ${filters.tag ? sql`and ${normalizeTag(filters.tag)} = any(c.tags)` : sql``}
       ${filters.organizationId ? sql`and c.organization_id = ${filters.organizationId}` : sql``}
     order by ${order}
     limit ${limit} offset ${offset}
  `;

  const total = rows[0]?.totalCount ?? 0;
  return {
    contacts: rows.map(({ totalCount: _total, ...contact }) => contact),
    total,
  };
}

async function selectContact(where: ReturnType<typeof sql>): Promise<Contact | null> {
  const [row] = await sql<Contact[]>`
    select ${contactSummaryColumns()},
           c.notes, c.source, c.reply_dismissed_at, c.created_at, c.updated_at
      from contacts c
      ${contactSummaryJoins()}
     where ${where}
  `;
  return row ?? null;
}

export async function getContact(id: string): Promise<Contact | null> {
  if (!isUuid(id)) return null;
  return selectContact(sql`c.id = ${id}`);
}

export async function getContactByEmail(email: string): Promise<Contact | null> {
  const normalized = normalizeEmail(email);
  return selectContact(sql`c.id = (select contact_id from contact_emails where email = ${normalized})`);
}

export interface ContactInput {
  name?: string | null;
  /** Either an id, or a name to find-or-create (case-insensitive). organizationId wins. */
  organizationId?: string | null;
  organizationName?: string | null;
  role?: string | null;
  notes?: string | null;
  tags?: string[];
  status?: ContactStatus;
  followUpAt?: string | null;
  followUpNote?: string | null;
  /** Replaces the contact's project memberships. */
  projectIds?: string[];
}

export class EmailTakenError extends Error {
  readonly email: string;
  readonly contactId: string;
  constructor(email: string, contactId: string) {
    super(`${email} already belongs to another contact`);
    this.name = "EmailTakenError";
    this.email = email;
    this.contactId = contactId;
  }
}

/**
 * Create a manual contact. Throws EmailTakenError if an address already belongs
 * to another contact. The first address is primary. Stats are refreshed so
 * existing mail with these addresses appears immediately.
 */
export async function createContact(input: ContactInput & { emails: string[] }): Promise<string> {
  const emails = uniqueEmails(input.emails);
  const organizationId = await resolveOrganizationId(input);

  return sql.begin(async (tx) => {
    if (emails.length) {
      const taken = await tx<{ email: string; contactId: string }[]>`
        select email, contact_id from contact_emails where email = any(${emails}::text[]) limit 1
      `;
      if (taken[0]) throw new EmailTakenError(taken[0].email, taken[0].contactId);
    }

    const [row] = await tx<{ id: string }[]>`
      insert into contacts ${tx({
        name: cleanText(input.name),
        organizationId: organizationId ?? null,
        role: cleanText(input.role),
        notes: cleanText(input.notes, false),
        tags: normalizeTags(input.tags ?? []),
        status: input.status ?? "active",
        followUpAt: input.followUpAt || null,
        followUpNote: cleanText(input.followUpNote),
        source: "manual",
      })}
      returning id
    `;

    for (const [index, email] of emails.entries()) {
      await tx`insert into contact_emails (email, contact_id, is_primary) values (${email}, ${row.id}, ${index === 0})`;
    }
    if (input.projectIds?.length) await replaceProjects(tx, row.id, input.projectIds);
    await tx`select refresh_contact_stats(${[row.id]}::uuid[])`;
    return row.id;
  });
}

/** Patch semantics: only keys present in `patch` are changed. Tags are normalized. */
export async function updateContact(id: string, patch: ContactInput): Promise<void> {
  const values: Record<string, unknown> = {};
  if ("name" in patch) values.name = cleanText(patch.name);
  if ("organizationId" in patch || "organizationName" in patch) {
    values.organizationId = (await resolveOrganizationId(patch)) ?? null;
  }
  if ("role" in patch) values.role = cleanText(patch.role);
  if ("notes" in patch) values.notes = cleanText(patch.notes, false);
  if (patch.tags !== undefined) values.tags = normalizeTags(patch.tags);
  if (patch.status !== undefined) values.status = patch.status;
  if ("followUpAt" in patch) values.followUpAt = patch.followUpAt || null;
  if ("followUpNote" in patch) values.followUpNote = cleanText(patch.followUpNote);

  await sql.begin(async (tx) => {
    if (Object.keys(values).length) {
      const result = await tx`update contacts set ${tx(values as never)} where id = ${id}`;
      if (result.count === 0) throw new Error("Contact not found");
    }
    if (patch.projectIds !== undefined) await replaceProjects(tx, id, patch.projectIds);
  });
}

export async function deleteContact(id: string): Promise<void> {
  await sql`delete from contacts where id = ${id}`;
}

/** Throws EmailTakenError when the address belongs to someone else. Refreshes stats. */
export async function addContactEmail(contactId: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) throw new Error(`Invalid email address: ${email}`);
  await sql.begin(async (tx) => {
    const [owner] = await tx<{ contactId: string }[]>`select contact_id from contact_emails where email = ${normalized}`;
    if (owner && owner.contactId !== contactId) throw new EmailTakenError(normalized, owner.contactId);
    if (owner) return;
    const [{ hasPrimary }] = await tx<{ hasPrimary: boolean }[]>`
      select exists (select 1 from contact_emails where contact_id = ${contactId} and is_primary) as has_primary
    `;
    await tx`insert into contact_emails (email, contact_id, is_primary) values (${normalized}, ${contactId}, ${!hasPrimary})`;
    await tx`select refresh_contact_stats(${[contactId]}::uuid[])`;
  });
}

/** Refuses to remove the last address. Promotes another address to primary if needed. Refreshes stats. */
export async function removeContactEmail(contactId: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  await sql.begin(async (tx) => {
    const rows = await tx<{ email: string; isPrimary: boolean }[]>`
      select email, is_primary from contact_emails where contact_id = ${contactId} order by is_primary desc, created_at
    `;
    const target = rows.find((r) => r.email === normalized);
    if (!target) return;
    if (rows.length === 1) throw new Error("A contact needs at least one address. Delete the contact instead.");
    await tx`delete from contact_emails where email = ${normalized} and contact_id = ${contactId}`;
    if (target.isPrimary) {
      const next = rows.find((r) => r.email !== normalized)!;
      await tx`update contact_emails set is_primary = true where email = ${next.email}`;
    }
    await tx`select refresh_contact_stats(${[contactId]}::uuid[])`;
  });
}

export async function setPrimaryEmail(contactId: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  await sql.begin(async (tx) => {
    const [owner] = await tx`select 1 from contact_emails where email = ${normalized} and contact_id = ${contactId}`;
    if (!owner) throw new Error("Address not found on this contact");
    await tx`update contact_emails set is_primary = false where contact_id = ${contactId} and is_primary`;
    await tx`update contact_emails set is_primary = true where email = ${normalized}`;
  });
}

/** merge_contacts(target, source). */
export async function mergeContacts(targetId: string, sourceId: string): Promise<void> {
  if (targetId === sourceId) throw new Error("Cannot merge a contact into itself");
  await sql`select merge_contacts(${targetId}, ${sourceId})`;
}

/** "Mark done" on reply lists: reply_dismissed_at = now(). */
export async function dismissReply(contactId: string): Promise<void> {
  await sql`update contacts set reply_dismissed_at = now() where id = ${contactId}`;
}

export async function addContactsToProject(contactIds: string[], projectId: string): Promise<void> {
  if (!contactIds.length) return;
  await sql`
    insert into contact_projects (contact_id, project_id)
    select unnest(${contactIds}::uuid[]), ${projectId}
    on conflict do nothing
  `;
}

export async function removeContactFromProject(contactId: string, projectId: string): Promise<void> {
  await sql`delete from contact_projects where contact_id = ${contactId} and project_id = ${projectId}`;
}

/** All tags in use with counts, most used first. */
export async function listTags(): Promise<{ tag: string; count: number }[]> {
  return sql<{ tag: string; count: number }[]>`
    select t as tag, count(*)::int as count
      from contacts c, unnest(c.tags) t
     where c.status <> 'archived'
     group by t
     order by count(*) desc, t
  `;
}

/**
 * Complete email history with a contact (all addresses, all accounts),
 * de-duplicated by RFC 822 Message-ID, newest first.
 * `before` pages backwards; `q` filters with full-text search.
 */
export async function getContactHistory(
  contactId: string,
  options: { limit?: number; before?: Date; q?: string; includeAutomated?: boolean } = {},
): Promise<EmailMessage[]> {
  const limit = clampLimit(options.limit, 50);
  const q = options.q?.trim();
  const rows = await sql`
    with ids as (
      select distinct mp.message_id
        from contact_emails ce
        join message_participants mp on mp.email = ce.email
       where ce.contact_id = ${contactId}
    )
    select ${messageColumns()}
      from ids
      join messages m on m.id = ids.message_id
      join gmail_accounts a on a.id = m.account_id
     where not exists (
             select 1 from messages d
              where d.rfc822_message_id = m.rfc822_message_id
                and d.id in (select message_id from ids)
                and (d.direction = 'inbound', d.created_at, d.id) < (m.direction = 'inbound', m.created_at, m.id)
           )
       ${options.before ? sql`and m.sent_at < ${options.before}` : sql``}
       ${q ? sql`and m.search @@ websearch_to_tsquery('english', ${q})` : sql``}
       ${options.includeAutomated === false ? sql`and not m.is_automated` : sql``}
     order by m.sent_at desc, m.id
     limit ${limit}
  `;
  return rows.map((row) => toEmailMessage(row as never));
}

/** Possible duplicates: other contacts with the same name (case-insensitive) or same address local part at a different domain. */
export async function findDuplicateCandidates(contactId: string): Promise<ContactSummary[]> {
  return sql<ContactSummary[]>`
    with me as (
      select nullif(lower(btrim(c.name)), '') as name,
             array(
               select split_part(ce.email, '@', 1) from contact_emails ce
                where ce.contact_id = c.id
                  and length(split_part(ce.email, '@', 1)) >= 4
                  and split_part(ce.email, '@', 1) <> all (${GENERIC_LOCAL_PARTS}::text[])
             ) as locals
        from contacts c
       where c.id = ${contactId}
    )
    select ${contactSummaryColumns()}
      from contacts c
      ${contactSummaryJoins()}
      cross join me
     where c.id <> ${contactId}
       and c.status <> 'archived'
       and (
         (me.name is not null and lower(btrim(c.name)) = me.name)
         or exists (
           select 1 from contact_emails ce
            where ce.contact_id = c.id and split_part(ce.email, '@', 1) = any(me.locals)
         )
       )
     order by c.last_contacted_at desc nulls last
     limit 10
  `;
}

const GENERIC_LOCAL_PARTS = [
  "info",
  "contact",
  "hello",
  "admin",
  "office",
  "mail",
  "team",
  "press",
  "booking",
  "bookings",
  "support",
  "sales",
  "studio",
  "gallery",
  "events",
  "news",
  "media",
  "jobs",
  "help",
  "billing",
  "accounts",
];

/* ------------------------------------------------------------------------- */

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function uniqueEmails(emails: string[]): string[] {
  const out: string[] = [];
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    if (!isValidEmail(email)) throw new Error(`Invalid email address: ${raw}`);
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))].sort();
}

/** Trim; empty → null. `singleLine` collapses whitespace. */
function cleanText(value: string | null | undefined, singleLine = true): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = singleLine ? value.replace(/\s+/g, " ").trim() : value.trim();
  return trimmed === "" ? null : trimmed;
}

async function resolveOrganizationId(input: ContactInput): Promise<string | null | undefined> {
  if (input.organizationId) return input.organizationId;
  const name = cleanText(input.organizationName);
  if (name) return findOrCreateOrganization(name);
  if ("organizationId" in input || "organizationName" in input) return null;
  return undefined;
}

async function replaceProjects(tx: Tx, contactId: string, projectIds: string[]): Promise<void> {
  const ids = [...new Set(projectIds.filter(Boolean))];
  await tx`delete from contact_projects where contact_id = ${contactId} and not (project_id = any(${ids}::uuid[]))`;
  if (ids.length) {
    await tx`
      insert into contact_projects (contact_id, project_id)
      select ${contactId}, unnest(${ids}::uuid[])
      on conflict do nothing
    `;
  }
}
