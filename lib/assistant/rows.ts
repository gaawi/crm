import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { addSheetRow } from "@/lib/queries/booking";
import { addContactEmail, createContact, getContactByEmail } from "@/lib/queries/contacts";
import { noEmDash } from "@/lib/text/no-em-dash";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

/**
 * New prospects added to a campaign by the prospector
 * (POST /api/assistant-agent/rows). Each becomes a row ("lead") with its
 * organization and contact, filed under a section that says where it came
 * from, with the reason it fits in the row's notes. Never a duplicate: an
 * address or an organization (by name or website domain) already in the
 * campaign is skipped. Each item succeeds or fails on its own.
 */

export const MAX_ROWS_PER_CALL = 25;

export const ROW_SOURCES = {
  email_history: "Nuevos · de nuestro email",
  owner_list: "Nuevos · listas",
  research: "Nuevos · investigación",
} as const;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? noEmDash(v) : undefined));

const rowSchema = z.object({
  organization: z.string().trim().min(1).max(200),
  website: optText(500),
  city: optText(120),
  contactName: optText(200),
  email: optText(320),
  role: optText(200),
  phone: optText(40),
  source: z.enum(Object.keys(ROW_SOURCES) as [keyof typeof ROW_SOURCES]),
  /** Why it fits the campaign's brief (one or two sentences, with the evidence). */
  reason: z.string().trim().min(1).max(1000),
  notes: optText(4000),
  /** Owner lists only: the list section ("Listas · 1 ya tocamos"…), a follow-up date and whether we played there. */
  section: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v.startsWith("Listas"), 'section must start with "Listas".')
    .nullish(),
  followUpAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "followUpAt must be YYYY-MM-DD.")
    .nullish(),
  returning: z.boolean().nullish(),
});

/** Completing an existing row of the campaign (e.g. from an owner list) with the person to write to. */
const attachSchema = z.object({
  opportunityId: z.guid(),
  email: z.string().trim().max(320),
  contactName: optText(200),
  role: optText(200),
  reason: z.string().trim().min(1).max(1000),
});

const bodySchema = z.object({ projectId: z.guid(), rows: z.array(z.unknown()).min(1).max(MAX_ROWS_PER_CALL) });

export type RowItemResult =
  | { index: number; ok: true; opportunityId: string; contactId: string | null }
  | { index: number; ok: false; error: string; existingOpportunityId?: string };

export class RowsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** "https://www.Venue.org/season" → "venue.org". */
export function siteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export async function applyRows(body: unknown): Promise<{ ok: true; created: number; skipped: number; results: RowItemResult[] }> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new RowsError(
      `Send {"projectId", "rows": [{"organization", "website"?, "city"?, "contactName"?, "email"?, "role"?, "phone"?, "source": "email_history" | "owner_list" | "research", "reason", "notes"?}]} (1–${MAX_ROWS_PER_CALL} rows).`,
      400,
    );
  }
  const { projectId } = parsed.data;
  const [project] = await sql<{ id: string; kind: string | null }[]>`
    select p.id,
           (select op.kind from opportunities op where op.project_id = p.id group by op.kind order by count(*) desc limit 1) as kind
      from projects p where p.id = ${projectId} and p.sheet and not p.archived`;
  if (!project) throw new RowsError("Campaign not found.", 404);

  const results: RowItemResult[] = [];
  for (const [index, raw] of parsed.data.rows.entries()) {
    if (raw && typeof raw === "object" && "opportunityId" in raw) {
      results.push(await attachContact(projectId, index, raw));
      continue;
    }
    const item = rowSchema.safeParse(raw);
    if (!item.success) {
      const issue = item.error.issues[0];
      results.push({ index, ok: false, error: issue ? `${issue.path.join(".") || "row"}: ${issue.message}` : "Invalid row." });
      continue;
    }
    const row = item.data;
    const email = row.email ? normalizeEmail(row.email) : null;
    if (email && !isValidEmail(email)) {
      results.push({ index, ok: false, error: `email: invalid address ${row.email}` });
      continue;
    }
    const domain = siteDomain(row.website);
    const [duplicate] = await sql<{ id: string; why: string }[]>`
      select op.id,
             case when ${email}::text is not null and exists (select 1 from contact_emails ce where ce.contact_id = op.contact_id and ce.email = ${email})
                  then 'address' else 'organization' end as why
        from opportunities op
        left join organizations o on o.id = op.organization_id
       where op.project_id = ${projectId}
         and (
           (${email}::text is not null and exists (select 1 from contact_emails ce where ce.contact_id = op.contact_id and ce.email = ${email}))
           or lower(btrim(o.name)) = lower(btrim(${row.organization}))
           or (${domain}::text is not null and (
                 regexp_replace(lower(coalesce(o.website, '')), '^(https?://)?(www\\.)?([^/]+).*$', '\\3') = ${domain}
                 or ${domain} = any(coalesce(o.domains, '{}'))))
         )
       limit 1`;
    if (duplicate) {
      results.push({ index, ok: false, error: `Already in this campaign (same ${duplicate.why}).`, existingOpportunityId: duplicate.id });
      continue;
    }
    try {
      const opportunityId = await addSheetRow({
        projectId,
        organization: noEmDash(row.organization),
        website: row.website,
        city: row.city,
        contactName: row.contactName,
        email: email ?? undefined,
        role: row.role,
        phone: row.phone,
        kind: (project.kind as never) ?? undefined,
        section: row.section ?? ROW_SOURCES[row.source],
        followUpAt: row.followUpAt ?? null,
        returning: row.returning ?? false,
        notes: [`Origen: ${ROW_SOURCES[row.source].replace("Nuevos · ", "")}. ${noEmDash(row.reason)}`, row.notes].filter(Boolean).join("\n\n"),
      });
      const [created] = await sql<{ contactId: string | null }[]>`select contact_id from opportunities where id = ${opportunityId}`;
      results.push({ index, ok: true, opportunityId, contactId: created?.contactId ?? null });
    } catch (e) {
      results.push({ index, ok: false, error: e instanceof Error ? e.message : "Could not add the row." });
    }
  }
  const created = results.filter((r) => r.ok).length;
  return { ok: true, created, skipped: results.length - created, results };
}

/**
 * Give an existing row its contact: the person found for it (verified
 * address). An existing contact with that address is linked; otherwise one is
 * created in the row's organization. A row whose contact has no address gets
 * this one; a row whose contact already has an address is left alone.
 */
async function attachContact(projectId: string, index: number, raw: unknown): Promise<RowItemResult> {
  const item = attachSchema.safeParse(raw);
  if (!item.success) {
    const issue = item.error.issues[0];
    return { index, ok: false, error: issue ? `${issue.path.join(".") || "row"}: ${issue.message}` : "Invalid row." };
  }
  const input = item.data;
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { index, ok: false, error: `email: invalid address ${input.email}` };
  const [row] = await sql<{ id: string; contactId: string | null; organizationId: string | null; notes: string | null; contactHasEmail: boolean }[]>`
    select op.id, op.contact_id, op.organization_id, op.notes,
           exists (select 1 from contact_emails ce where ce.contact_id = op.contact_id) as contact_has_email
      from opportunities op where op.id = ${input.opportunityId} and op.project_id = ${projectId}`;
  if (!row) return { index, ok: false, error: "Not a row of this campaign." };
  const [elsewhere] = await sql<{ id: string }[]>`
    select op.id from opportunities op join contact_emails ce on ce.contact_id = op.contact_id
     where op.project_id = ${projectId} and ce.email = ${email} and op.id <> ${row.id} limit 1`;
  if (elsewhere) return { index, ok: false, error: "That address is already another row of this campaign.", existingOpportunityId: elsewhere.id };

  let contactId: string;
  try {
    if (row.contactId && row.contactHasEmail)
      return { index, ok: false, error: "The row already has a contact with an address (fill its card with POST contacts)." };
    if (row.contactId) {
      await addContactEmail(row.contactId, email);
      contactId = row.contactId;
    } else {
      const existing = await getContactByEmail(email);
      contactId =
        existing?.id ??
        (await createContact({
          name: input.contactName ?? null,
          emails: [email],
          organizationId: row.organizationId,
          role: input.role ?? null,
          status: "lead",
          projectIds: [projectId],
        }));
      await sql`update opportunities set contact_id = ${contactId} where id = ${row.id}`;
    }
  } catch (e) {
    return { index, ok: false, error: e instanceof Error ? e.message : "Could not attach the contact." };
  }
  await sql`
    update contacts
       set name = coalesce(nullif(btrim(name), ''), ${input.contactName ?? null}),
           role = coalesce(nullif(btrim(role), ''), ${input.role ?? null}),
           organization_id = coalesce(organization_id, ${row.organizationId}),
           status = case when status = 'new' then 'lead' else status end
     where id = ${contactId}`;
  await sql`insert into contact_projects (contact_id, project_id) values (${contactId}, ${projectId}) on conflict do nothing`;
  const note = `Contacto añadido por el buscador: ${noEmDash(input.reason)}`;
  await sql`update opportunities set notes = ${row.notes ? `${row.notes}\n\n${note}` : note} where id = ${row.id}`;
  return { index, ok: true, opportunityId: row.id, contactId };
}

const listSchema = z.object({
  projectId: z.guid(),
  /** Rows whose section starts with this ("Listas", "Listas · 2"…). */
  section: z.string().trim().max(120).optional(),
  withoutContact: z.enum(["1", "true", "0", "false"]).optional(),
  unresearched: z.enum(["1", "true", "0", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/**
 * GET /api/assistant-agent/rows: a campaign's rows with their full notes, in
 * the order the prospector works them (section, then name), filtered by
 * section prefix, rows without a contact, or rows whose card was never filled.
 */
export async function listRows(params: URLSearchParams) {
  const parsed = listSchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new RowsError("Pass projectId and optionally section, withoutContact=1, unresearched=1, limit (max 200), offset.", 400);
  const { projectId, section, limit, offset } = parsed.data;
  const withoutContact = parsed.data.withoutContact === "1" || parsed.data.withoutContact === "true";
  const unresearched = parsed.data.unresearched === "1" || parsed.data.unresearched === "true";
  const [project] = await sql`select 1 from projects where id = ${projectId} and sheet`;
  if (!project) throw new RowsError("Campaign not found.", 404);
  const filter = sql`
    op.project_id = ${projectId}
    ${section ? sql`and op.sheet_section ilike ${`${section.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}` : sql``}
    ${withoutContact ? sql`and op.contact_id is null` : sql``}
    ${unresearched ? sql`and (c.id is null or c.researched_at is null)` : sql``}`;
  const [{ total }] = await sql<{ total: number }[]>`
    select count(*)::int as total from opportunities op left join contacts c on c.id = op.contact_id where ${filter}`;
  const rows = await sql<
    {
      opportunityId: string;
      organization: string | null;
      website: string | null;
      city: string | null;
      section: string | null;
      stage: string;
      followUpAt: string | null;
      returning: boolean;
      notes: string | null;
      contact: { id: string; name: string | null; email: string | null; role: string | null; researchedAt: string | null } | null;
    }[]
  >`
    select op.id as opportunity_id, o.name as organization, o.website, o.city, op.sheet_section as section, op.stage,
           op.follow_up_at::text as follow_up_at, op.is_returning as returning, op.notes,
           case when c.id is null then null else json_build_object(
             'id', c.id, 'name', nullif(btrim(c.name), ''), 'role', nullif(btrim(c.role), ''), 'researchedAt', c.researched_at,
             'email', (select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1)) end as contact
      from opportunities op
      left join organizations o on o.id = op.organization_id
      left join contacts c on c.id = op.contact_id
     where ${filter}
     order by op.sheet_section nulls last, lower(coalesce(o.name, op.title))
     limit ${limit} offset ${offset}`;
  return { projectId, total, count: rows.length, rows };
}
