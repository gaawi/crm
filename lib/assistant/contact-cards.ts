import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { httpsUrlIssue, normalizeHttpsUrl } from "@/lib/contacts/photo";
import { findOrCreateOrganization } from "@/lib/queries/organizations";
import { cleanPhone } from "@/lib/queries/contacts";
import { contactExists, contactIdForEmail } from "@/lib/queries/contact-photos";
import { noEmDash } from "@/lib/text/no-em-dash";
import { isValidEmail } from "@/lib/utils";

/**
 * Contact cards filled by Claude before it writes an email
 * (POST /api/assistant-agent/contacts). Only empty fields are filled: what
 * the owner wrote is never replaced (research notes are added under their
 * notes). Every fact needs the page it came from (`sources`); an item with
 * nothing found still marks the card as researched. Each item succeeds or
 * fails on its own.
 */

export const MAX_CARDS_PER_CALL = 50;
const MAX_SOURCES = 20;

const bodySchema = z.object({ contacts: z.array(z.unknown()).min(1).max(MAX_CARDS_PER_CALL) });

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? noEmDash(v) : undefined));

const itemSchema = z.object({
  contactId: z.guid("contactId must be a uuid.").nullish(),
  email: z.string().trim().max(320).refine(isValidEmail, "Invalid email address.").nullish(),
  name: optText(200),
  role: optText(200),
  organization: optText(200),
  phone: optText(40),
  whatsapp: optText(40),
  notes: optText(2000),
  sources: z.array(z.unknown()).max(10).nullish(),
});

type CardText = "name" | "role" | "organization" | "phone" | "whatsapp" | "notes";

export type CardItemResult =
  | { index: number; ok: true; contactId: string; filled: CardText[]; kept: CardText[] }
  | { index: number; ok: false; error: string; contactId?: string };

export interface ApplyCardsResult {
  ok: true;
  updated: number;
  failed: number;
  results: CardItemResult[];
}

export class ContactCardsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function zodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "item"}: ${issue.message}` : "Invalid item.";
}

async function resolveContact(item: { contactId?: string | null; email?: string | null }): Promise<{ id: string } | { error: string }> {
  if (!item.contactId && !item.email) return { error: "Give contactId or email." };
  let byId: string | null = null;
  if (item.contactId) {
    if (!(await contactExists(item.contactId))) return { error: `Contact ${item.contactId} not found.` };
    byId = item.contactId.toLowerCase();
  }
  if (item.email) {
    const id = await contactIdForEmail(item.email);
    if (!id) return { error: `No contact with the address ${item.email}.` };
    if (byId && byId !== id) return { error: "contactId and email point to different contacts." };
    return { id };
  }
  return { id: byId! };
}

export async function applyContactCards(body: unknown, now: Date = new Date()): Promise<ApplyCardsResult> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ContactCardsError(
      `Send {"contacts": [{contactId | email, name?, role?, organization?, phone?, whatsapp?, notes?, sources}]} (1–${MAX_CARDS_PER_CALL} items).`,
      400,
    );
  }
  const results: CardItemResult[] = [];
  for (const [index, raw] of parsed.data.contacts.entries()) {
    const item = itemSchema.safeParse(raw);
    if (!item.success) {
      results.push({ index, ok: false, error: zodIssue(item.error) });
      continue;
    }
    const input = item.data;
    const sources: string[] = [];
    let sourceError: string | null = null;
    for (const [i, s] of (input.sources ?? []).entries()) {
      const issue = httpsUrlIssue(s);
      if (issue) {
        sourceError = `sources.${i}: ${issue}`;
        break;
      }
      const url = normalizeHttpsUrl(s)!;
      if (!sources.includes(url)) sources.push(url);
    }
    if (sourceError) {
      results.push({ index, ok: false, error: sourceError });
      continue;
    }
    const given = (["name", "role", "organization", "phone", "whatsapp", "notes"] as const).filter((k) => input[k]);
    if (given.length && !sources.length) {
      results.push({ index, ok: false, error: "sources: give the page(s) where you found this (official or professional sources only)." });
      continue;
    }
    const target = await resolveContact(input);
    if ("error" in target) {
      results.push({ index, ok: false, error: target.error });
      continue;
    }

    let phone: string | null = null;
    let whatsapp: string | null = null;
    try {
      // Always international: a number without "+" gets the prefix of the contact's campaign, else it is refused.
      const prefix = input.phone || input.whatsapp ? await campaignPrefix(target.id) : null;
      phone = input.phone ? internationalPhone(input.phone, prefix) : null;
      whatsapp = input.whatsapp ? internationalPhone(input.whatsapp, prefix) : null;
    } catch (e) {
      results.push({ index, ok: false, contactId: target.id, error: e instanceof Error ? e.message : "Invalid phone number." });
      continue;
    }

    const [current] = await sql<
      {
        name: string | null;
        role: string | null;
        organizationId: string | null;
        phone: string | null;
        whatsapp: string | null;
        notes: string | null;
        researchSources: string[];
      }[]
    >`select nullif(btrim(name), '') as name, nullif(btrim(role), '') as role, organization_id, phone, whatsapp, notes, research_sources
        from contacts where id = ${target.id}`;
    if (!current) {
      results.push({ index, ok: false, error: `Contact ${target.id} not found.` });
      continue;
    }
    const values: Record<string, unknown> = {};
    const filled: CardText[] = [];
    const kept: CardText[] = [];
    const fill = (key: CardText, has: boolean, apply: () => void) => {
      if (!input[key]) return;
      if (has) kept.push(key);
      else {
        apply();
        filled.push(key);
      }
    };
    fill("name", Boolean(current.name), () => (values.name = input.name));
    fill("role", Boolean(current.role), () => (values.role = input.role));
    fill("phone", Boolean(current.phone), () => (values.phone = phone));
    fill("whatsapp", Boolean(current.whatsapp), () => (values.whatsapp = whatsapp));
    if (input.organization) {
      if (current.organizationId) kept.push("organization");
      else {
        values.organizationId = await findOrCreateOrganization(input.organization);
        filled.push("organization");
      }
    }
    if (input.notes) {
      const notes = current.notes?.trim() ?? "";
      if (notes.includes(input.notes)) kept.push("notes");
      else {
        values.notes = notes ? `${notes}\n\n${input.notes}` : input.notes;
        filled.push("notes");
      }
    }
    values.researchedAt = now;
    values.researchSources = [...new Set([...sources, ...current.researchSources])].slice(0, MAX_SOURCES);
    await sql`update contacts set ${sql(values as never)} where id = ${target.id}`;
    results.push({ index, ok: true, contactId: target.id, filled, kept });
  }
  const updated = results.filter((r) => r.ok).length;
  return { ok: true, updated, failed: results.length - updated, results };
}

/** The phone prefix of a campaign the contact is a row of ("+1" for Booking USA), if any. */
async function campaignPrefix(contactId: string): Promise<string | null> {
  const [row] = await sql<{ prefix: string }[]>`
    select p.phone_prefix as prefix from opportunities op join projects p on p.id = op.project_id
     where op.contact_id = ${contactId} and p.phone_prefix is not null
     order by op.updated_at desc limit 1`;
  return row?.prefix ?? null;
}

/** A stored number always carries its country code. */
function internationalPhone(value: string, prefix: string | null): string | null {
  const phone = cleanPhone(value, prefix);
  if (phone && !phone.startsWith("+"))
    throw new Error(`Give the number with its international prefix (e.g. +1 269 382 7774, +34 612 345 678): ${value.trim()}`);
  return phone;
}
