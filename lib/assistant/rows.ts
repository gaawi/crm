import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { addSheetRow } from "@/lib/queries/booking";
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
  notes: optText(2000),
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
        section: ROW_SOURCES[row.source],
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
