import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { applyContactCards } from "@/lib/assistant/contact-cards";
import { httpsUrlIssue, normalizeHttpsUrl } from "@/lib/contacts/photo";
import { contactIdForEmail, setContactPhoto } from "@/lib/queries/contact-photos";
import { noEmDash } from "@/lib/text/no-em-dash";
import { isValidEmail } from "@/lib/utils";

/**
 * The people of an organization found by Claude on its official pages
 * (POST /api/assistant-agent/people): the artistic director, the programmer,
 * the executive director… Each person is matched to an existing contact (by
 * email, else by the same name at this organization) and only their empty
 * fields are filled; someone not in VELA yet is created at the organization.
 * Two contacts with that name at the organization: nothing is merged, the item
 * fails. Every person needs the page(s) they were found on. A photo is set
 * only on a contact without one.
 */

export const MAX_PEOPLE_PER_CALL = 30;

const bodySchema = z.object({
  organizationId: z.guid("organizationId must be a uuid."),
  people: z.array(z.unknown()).min(1).max(MAX_PEOPLE_PER_CALL),
});

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? noEmDash(v) : undefined));

const itemSchema = z.object({
  name: z.string().trim().min(2).max(200),
  role: optText(200),
  email: z
    .string()
    .trim()
    .max(320)
    .refine(isValidEmail, "Invalid email address.")
    .nullish()
    .transform((v) => v?.toLowerCase()),
  phone: optText(40),
  bio: optText(1200),
  photo: z.unknown().optional(),
  photoSource: z.unknown().optional(),
  profileUrl: z.unknown().optional(),
  linkedin: z.unknown().optional(),
  sources: z.array(z.unknown()).min(1).max(10),
});

export type PersonResult =
  | { index: number; ok: true; contactId: string; created: boolean; filled: string[]; photo: boolean }
  | { index: number; ok: false; error: string };

export class PeopleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const TITLES = new Set(["dr", "mr", "mrs", "ms", "prof", "sir", "dame", "rev", "jr", "sr", "ii", "iii"]);

/** "Shain, Joshua" and "Dr. Joshua Shain" give the same key. */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1 && !TITLES.has(t))
    .sort()
    .join(" ");
}

function optionalHttps(value: unknown, field: string): { url?: string; error?: string } {
  if (value === undefined || value === null || value === "") return {};
  const issue = httpsUrlIssue(value);
  return issue ? { error: `${field}: ${issue}` } : { url: normalizeHttpsUrl(value as string) ?? undefined };
}

export async function applyPeople(body: unknown): Promise<{ ok: true; organizationId: string; created: number; updated: number; failed: number; results: PersonResult[] }> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new PeopleError(
      `Send {"organizationId", "people": [{name, role?, email?, phone?, bio?, photo?, photoSource?, profileUrl?, linkedin?, sources}]} (1–${MAX_PEOPLE_PER_CALL} items).`,
      400,
    );
  }
  const { organizationId } = parsed.data;
  const [org] = await sql<{ id: string }[]>`select id from organizations where id = ${organizationId}`;
  if (!org) throw new PeopleError(`Organization ${organizationId} not found.`, 404);

  const results: PersonResult[] = [];
  for (const [index, raw] of parsed.data.people.entries()) {
    const item = itemSchema.safeParse(raw);
    if (!item.success) {
      const issue = item.error.issues[0];
      results.push({ index, ok: false, error: issue ? `${issue.path.join(".") || "item"}: ${issue.message}` : "Invalid item." });
      continue;
    }
    const p = item.data;
    const links: Record<string, string> = {};
    let linkError: string | undefined;
    for (const [field, value] of [
      ["photo", p.photo],
      ["photoSource", p.photoSource],
      ["profileUrl", p.profileUrl],
      ["linkedin", p.linkedin],
    ] as const) {
      const checked = optionalHttps(value, field);
      if (checked.error) linkError = checked.error;
      else if (checked.url) links[field] = checked.url;
    }
    if (linkError) {
      results.push({ index, ok: false, error: linkError });
      continue;
    }

    // The same person: their email, else the same name at this organization.
    let contactId = p.email ? await contactIdForEmail(p.email) : null;
    if (!contactId) {
      const key = nameKey(p.name);
      const sameName = (await sql<{ id: string; name: string | null }[]>`select id, name from contacts where organization_id = ${organizationId} and status <> 'archived'`).filter(
        (c) => c.name && nameKey(c.name) === key,
      );
      if (sameName.length > 1) {
        results.push({ index, ok: false, error: `${sameName.length} contacts named ${p.name} at this organization: merge them first.` });
        continue;
      }
      contactId = sameName[0]?.id ?? null;
    }

    let created = false;
    if (!contactId) {
      const [row] = await sql<{ id: string }[]>`
        insert into contacts (name, organization_id, status, source) values (${p.name}, ${organizationId}, 'lead', 'manual') returning id`;
      contactId = row.id;
      created = true;
    } else {
      await sql`update contacts set organization_id = ${organizationId}, updated_at = now() where id = ${contactId} and organization_id is null`;
    }
    if (p.email) {
      try {
        await sql`
          insert into contact_emails (contact_id, email, is_primary)
          values (${contactId}, ${p.email}, not exists (select 1 from contact_emails where contact_id = ${contactId} and is_primary))
          on conflict do nothing`;
      } catch {
        // One of the owner's own addresses, or already someone else's: the person is kept without it.
      }
    }

    const notes = [
      p.bio,
      links.profileUrl ? `Profile: ${links.profileUrl}` : null,
      links.linkedin ? `LinkedIn: ${links.linkedin}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const card = await applyContactCards({
      contacts: [{ contactId, name: p.name, role: p.role, phone: p.phone, notes: notes || undefined, sources: p.sources }],
    });
    const cardResult = card.results[0];
    if (!cardResult?.ok) {
      results.push({ index, ok: false, error: cardResult && "error" in cardResult ? cardResult.error : "Could not save the card." });
      continue;
    }

    let photo = false;
    if (links.photo) {
      const [current] = await sql<{ photoUrl: string | null }[]>`select photo_url from contacts where id = ${contactId}`;
      if (!current?.photoUrl) photo = await setContactPhoto(contactId, links.photo, links.photoSource ?? links.profileUrl ?? null);
    }
    results.push({ index, ok: true, contactId, created, filled: cardResult.filled, photo });
  }
  const ok = results.filter((r) => r.ok);
  return {
    ok: true,
    organizationId,
    created: ok.filter((r) => r.ok && r.created).length,
    updated: ok.filter((r) => r.ok && !r.created).length,
    failed: results.length - ok.length,
    results,
  };
}
