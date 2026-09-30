import "server-only";
import { z } from "zod";
import { CONTACT_STATUSES, OPPORTUNITY_KINDS, OPPORTUNITY_STAGES, ORGANIZATION_KINDS } from "@/lib/constants";
import type { ContactStatus, OpportunityKind, OpportunityStage, OrganizationKind } from "@/lib/types";
import { isValidEmail, normalizeEmail, normalizeTag, splitList } from "@/lib/utils";

/**
 * Input parsing shared by the server actions of the app. Everything that
 * arrives from a form (or a bound argument, which the client can tamper with)
 * goes through here before it reaches lib/queries.
 */

/** Any 8-4-4-4-12 hex id (Postgres uuid shape). */
export const idSchema = z.guid();

export function parseId(value: unknown): string {
  return idSchema.parse(value);
}

export function isId(value: unknown): value is string {
  return idSchema.safeParse(value).success;
}

export const statusSchema = z.enum(CONTACT_STATUSES.map((s) => s.value) as [ContactStatus, ...ContactStatus[]]);
export const stageSchema = z.enum(OPPORTUNITY_STAGES.map((s) => s.value) as [OpportunityStage, ...OpportunityStage[]]);
export const opportunityKindSchema = z.enum(OPPORTUNITY_KINDS.map((k) => k.value) as [OpportunityKind, ...OpportunityKind[]]);
export const organizationKindSchema = z.enum(
  ORGANIZATION_KINDS.map((k) => k.value) as [OrganizationKind, ...OrganizationKind[]],
);

/** "" → null, otherwise a real YYYY-MM-DD date. */
export const optionalDateSchema = z
  .union([z.literal(""), z.iso.date()])
  .transform((value) => (value === "" ? null : value));

/** "" → null, otherwise a uuid. */
export const optionalIdSchema = z
  .union([z.literal(""), idSchema])
  .transform((value) => (value === "" ? null : value));

export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Values of a multi-valued field (checkbox group), ignoring anything that is not an id. */
export function idList(formData: FormData, name: string): string[] {
  return [...new Set(formData.getAll(name).filter((v): v is string => typeof v === "string" && idSchema.safeParse(v).success))];
}

/** "a, b\nc" → normalized tags. */
export function parseTags(value: string): string[] {
  return [...new Set(splitList(value).map(normalizeTag).filter(Boolean))];
}

/**
 * Addresses typed one per line, or separated by commas, semicolons or spaces.
 * Surrounding <> and quotes are ignored. Returns the first invalid token as an error.
 */
export function parseEmailList(value: string): { emails: string[]; invalid?: string } {
  const emails: string[] = [];
  for (const raw of value.split(/[\s,;]+/)) {
    const token = raw.replace(/^[<"'(]+|[>"')]+$/g, "");
    if (!token) continue;
    const email = normalizeEmail(token);
    if (!isValidEmail(email)) return { emails, invalid: token };
    if (!emails.includes(email)) emails.push(email);
  }
  return { emails };
}

export function parseEmail(value: string): string | null {
  const email = normalizeEmail(value.replace(/^[<"']+|[>"']+$/g, ""));
  return isValidEmail(email) ? email : null;
}

/** Single-line text, trimmed and capped. */
export const shortText = z.string().trim().max(300);
export const longText = z.string().max(20_000);

/**
 * In-app path to go back to after a form (e.g. "/contacts/<id>?tab=deals").
 * Anything that is not a plain same-origin path falls back to `fallback`.
 */
export function safeReturnPath(value: string, fallback: string): string {
  return /^\/(?!\/)[\w\-/?=&%.]*$/.test(value) && value.length <= 500 ? value : fallback;
}
