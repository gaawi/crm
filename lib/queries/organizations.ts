import "server-only";
import { sql } from "@/lib/db";
import type { ContactSummary, EmailMessage, Organization } from "@/lib/types";
import { normalizeTag } from "@/lib/utils";
import {
  clampLimit,
  contactSummaryColumns,
  contactSummaryJoins,
  likePattern,
  messageColumns,
  toEmailMessage,
} from "@/lib/queries/shared";

const organizationColumns = () => sql`
  o.id, o.name, o.domains, o.website, o.notes, o.tags, o.created_at, o.updated_at,
  (select count(*)::int from contacts c where c.organization_id = o.id and c.status <> 'archived') as contact_count,
  (select max(c.last_contacted_at) from contacts c where c.organization_id = o.id) as last_contacted_at
`;

export async function listOrganizations(options: { q?: string; limit?: number } = {}): Promise<Organization[]> {
  const q = options.q?.trim();
  const pattern = q ? likePattern(q) : null;
  return sql<Organization[]>`
    select * from (
      select ${organizationColumns()}
        from organizations o
       where true
         ${
           pattern
             ? sql`and (o.name ilike ${pattern} or exists (select 1 from unnest(o.domains) d where d ilike ${pattern})
                       or exists (select 1 from unnest(o.tags) t where t ilike ${pattern}))`
             : sql``
         }
    ) x
    order by x.last_contacted_at desc nulls last, lower(x.name)
    limit ${clampLimit(options.limit, 200)}
  `;
}

export async function getOrganization(id: string): Promise<Organization | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<Organization[]>`select ${organizationColumns()} from organizations o where o.id = ${id}`;
  return row ?? null;
}

/** Case-insensitive exact name match. */
export async function getOrganizationByName(name: string): Promise<Organization | null> {
  const [row] = await sql<Organization[]>`
    select ${organizationColumns()} from organizations o where lower(o.name) = lower(${name.trim()})
  `;
  return row ?? null;
}

export interface OrganizationInput {
  name?: string;
  /** Lower-cased, "@" and "www." stripped, de-duplicated. */
  domains?: string[];
  website?: string | null;
  notes?: string | null;
  tags?: string[];
}

/** Returns the id. Also links unaffiliated contacts whose address matches one of the domains. */
export async function createOrganization(input: OrganizationInput & { name: string }): Promise<string> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Organization name is required");
  const domains = normalizeDomains(input.domains ?? []);
  const [row] = await sql<{ id: string }[]>`
    insert into organizations ${sql({
      name,
      domains,
      website: emptyToNull(input.website),
      notes: emptyToNull(input.notes),
      tags: [...new Set((input.tags ?? []).map(normalizeTag).filter(Boolean))],
    })}
    returning id
  `;
  if (domains.length) await linkContactsByDomain(row.id);
  return row.id;
}

/** Patch semantics. When domains change, links unaffiliated contacts with matching addresses. */
export async function updateOrganization(id: string, patch: OrganizationInput): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.replace(/\s+/g, " ").trim();
    if (!name) throw new Error("Organization name is required");
    values.name = name;
  }
  if (patch.domains !== undefined) values.domains = normalizeDomains(patch.domains);
  if ("website" in patch) values.website = emptyToNull(patch.website);
  if ("notes" in patch) values.notes = emptyToNull(patch.notes);
  if (patch.tags !== undefined) values.tags = [...new Set(patch.tags.map(normalizeTag).filter(Boolean))];
  if (!Object.keys(values).length) return;
  await sql`update organizations set ${sql(values as never)} where id = ${id}`;
  if (patch.domains !== undefined) await linkContactsByDomain(id);
}

/** Contacts are kept (organization_id set null). */
export async function deleteOrganization(id: string): Promise<void> {
  await sql`delete from organizations where id = ${id}`;
}

/** Find by name (case-insensitive) or create. */
export async function findOrCreateOrganization(name: string): Promise<string> {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Organization name is required");
  const [row] = await sql<{ id: string }[]>`
    with found as (select id from organizations where lower(name) = lower(${clean})),
    inserted as (
      insert into organizations (name)
      select ${clean} where not exists (select 1 from found)
      on conflict do nothing
      returning id
    )
    select id from found union all select id from inserted
  `;
  if (row) return row.id;
  // Lost a race with a concurrent insert: read it back.
  const [again] = await sql<{ id: string }[]>`select id from organizations where lower(name) = lower(${clean})`;
  return again.id;
}

/** Contacts of the organization (all statuses except archived), by last contact. */
export async function getOrganizationContacts(id: string): Promise<ContactSummary[]> {
  return sql<ContactSummary[]>`
    select ${contactSummaryColumns()}
      from contacts c
      ${contactSummaryJoins()}
     where c.organization_id = ${id} and c.status <> 'archived'
     order by c.last_contacted_at desc nulls last, lower(coalesce(c.name, ''))
  `;
}

/**
 * All correspondence with the organization: messages involving its contacts or
 * any address at one of its domains, de-duplicated, newest first. `before`
 * pages backwards; `q` full-text filter.
 */
export async function getOrganizationHistory(
  id: string,
  options: { limit?: number; before?: Date; q?: string } = {},
): Promise<EmailMessage[]> {
  const limit = clampLimit(options.limit, 50);
  const q = options.q?.trim();
  const rows = await sql`
    with org as (select domains from organizations where id = ${id}),
    ids as (
      select mp.message_id
        from contacts c
        join contact_emails ce on ce.contact_id = c.id
        join message_participants mp on mp.email = ce.email
       where c.organization_id = ${id}
      union
      select mp.message_id
        from org, message_participants mp
       where cardinality(org.domains) > 0
         and split_part(mp.email, '@', 2) = any(org.domains)
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
     order by m.sent_at desc, m.id
     limit ${limit}
  `;
  return rows.map((row) => toEmailMessage(row as never));
}

/** Set organization_id on contacts without an organization whose addresses use one of its domains. Returns count. */
export async function linkContactsByDomain(id: string): Promise<number> {
  const result = await sql`
    update contacts c
       set organization_id = o.id
      from organizations o
     where o.id = ${id}
       and cardinality(o.domains) > 0
       and c.organization_id is null
       and exists (
         select 1 from contact_emails ce
          where ce.contact_id = c.id and split_part(ce.email, '@', 2) = any(o.domains)
       )
  `;
  return result.count;
}

/* ------------------------------------------------------------------------- */

export function normalizeDomains(values: string[]): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    let value = raw.trim().toLowerCase();
    if (!value) continue;
    value = value.replace(/^[a-z]+:\/\//, "").replace(/^[^@]*@/, "").replace(/^www\./, "");
    value = value.split(/[/?#:\s]/)[0];
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) out.add(value);
  }
  return [...out];
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
