/**
 * Email templates for booking sheets (client and server): placeholders, the
 * values a sheet row fills them with, and which template fits a row now.
 */
import { formatFee } from "@/lib/booking/fee";
import type { CallOutcome, NextAction, OpportunityStage, TemplateTrigger } from "@/lib/types";

export { formatFee };

/** Why an email prepared from a sheet is in Approvals (and how Approvals tells it apart from Claude's). */
const RATIONALE_PREFIX = "Campaign ";
/** Emails prepared before booking sheets were renamed Campaigns still read as template emails. */
const LEGACY_RATIONALE_PREFIX = "Booking sheet ";
export function templateRationale(sheetName: string, templateName: string): string {
  return `${RATIONALE_PREFIX}"${sheetName}" · template "${templateName}"`;
}
export function isTemplateRationale(rationale: string | null | undefined): boolean {
  return Boolean(rationale?.startsWith(`${RATIONALE_PREFIX}"`) || rationale?.startsWith(`${LEGACY_RATIONALE_PREFIX}"`));
}

export const TEMPLATE_VARIABLE_NAMES = [
  "first_name",
  "contact_name",
  "venue",
  "city",
  "spaces",
  "dates",
  "fee",
  "sheet",
  "my_name",
  "signature",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLE_NAMES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string | null | undefined>>;

const KNOWN = new Set<string>(TEMPLATE_VARIABLE_NAMES);

const HONORIFICS = new Set(
  ["sr", "sra", "srta", "dr", "dra", "d", "dña", "dª", "don", "doña", "mr", "mrs", "ms", "miss", "prof", "profa", "mme", "mlle", "m", "herr", "frau"].map(
    (h) => h.normalize("NFC"),
  ),
);

/**
 * First name for a greeting: the first word of the contact's name, without
 * honorifics ("Sra. María José García" → "María"). An ALL-CAPS name is
 * title-cased ("ANA LÓPEZ" → "Ana"). Empty when there is no name.
 */
export function firstName(name: string | null | undefined): string {
  const words = (name ?? "").normalize("NFC").split(/[\s/,()]+/).filter(Boolean);
  for (const word of words) {
    const bare = word.replace(/\.+$/, "").toLowerCase();
    if (HONORIFICS.has(bare)) continue;
    if (word.includes("@")) return "";
    const clean = word.replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, "");
    if (!clean) continue;
    return clean === clean.toUpperCase() && clean.length > 1 ? clean[0] + clean.slice(1).toLowerCase() : clean;
  }
  return "";
}

/**
 * Replace {{first_name}}, {{venue}}, … (spaces inside the braces allowed).
 * Unknown placeholders are left as written; known ones without a value become
 * empty. {{first_name}} falls back to the first name of {{contact_name}}.
 */
export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!KNOWN.has(name)) return match;
    if (name === "first_name" && vars.first_name === undefined) return firstName(vars.contact_name);
    return vars[name as TemplateVariable]?.trim() ?? "";
  });
}

/** Placeholders used in a text that renderTemplate does not know (typos like {{nombre}}). */
export function unknownPlaceholders(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    if (!KNOWN.has(m[1].toLowerCase())) out.add(m[1]);
  }
  return [...out];
}

/** The parts of a sheet row a template reads (SheetRow satisfies it). */
export interface TemplateRow {
  title: string;
  value: string | null;
  currency: string;
  eventDates: string | null;
  spaces: string | null;
  organization: { name: string; city: string | null } | null;
  contact: { name: string | null } | null;
}

/** The values a row fills a template with. `profile` = Settings → name and signature. */
export function rowTemplateVars(
  row: TemplateRow,
  sheet: { name: string },
  profile?: { name?: string | null; signature?: string | null } | null,
): TemplateVars {
  const contactName = row.contact?.name?.trim() || "";
  return {
    first_name: firstName(contactName),
    contact_name: contactName,
    venue: row.organization?.name ?? row.title,
    city: row.organization?.city ?? "",
    spaces: row.spaces ?? "",
    dates: row.eventDates ?? "",
    fee: formatFee(row.value, row.currency),
    sheet: sheet.name,
    my_name: profile?.name ?? "",
    signature: profile?.signature ?? "",
  };
}

/** The parts of a template suggestTemplate reads (EmailTemplate satisfies it). */
export interface TemplateLike {
  id: string;
  projectId: string | null;
  name: string;
  trigger: TemplateTrigger;
  sortOrder: number;
}

/** The parts of a row suggestTemplate reads (SheetRow satisfies it). Timestamps: Date or ISO string. */
export interface SuggestRow {
  stage: OpportunityStage;
  returning: boolean;
  /** The row's structured next step: when it maps to a trigger with a template, that template wins. */
  nextAction?: NextAction | null;
  /** Latest call on the row or its contact. */
  lastCall: { outcome: CallOutcome | null; occurredAt: string | Date } | null;
  contact: { lastOutboundAt: string | Date | null } | null;
}

const time = (value: string | Date | null | undefined) => (value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY);

/**
 * Template triggers a next action asks for (best first). Actions without an
 * email of their own (call, meeting, invoice…) map to none.
 */
export function nextActionTriggers(action: NextAction | null | undefined, returning = false): TemplateTrigger[] {
  switch (action) {
    case "send_proposal":
    case "first_contact":
      return returning ? ["returning", "first_contact"] : ["first_contact"];
    case "follow_up":
    case "wait_reply":
      return ["follow_up"];
    case "keep_informed":
      return ["keep_informed"];
    case "thank_report":
      return ["thanks"];
    case "agree_terms":
    case "send_contract":
    case "close_contract":
      return ["next_steps"];
    case "logistics":
      return ["confirmed"];
    default:
      return [];
  }
}

/**
 * Template triggers that fit the row, best first. First those of the row's
 * next action (nextActionTriggers), then by status:
 * To contact → first contact (returning venues: returning, then first contact);
 * Contacted / Offer sent → after a call (when you talked or were asked to call
 * back since your last email), else follow-up; In conversation → next steps;
 * Confirmed → confirmed; Declined → declined.
 */
export function suggestedTriggers(row: SuggestRow): TemplateTrigger[] {
  const byAction = nextActionTriggers(row.nextAction, row.returning);
  return [...new Set([...byAction, ...stageTriggers(row)])];
}

function stageTriggers(row: SuggestRow): TemplateTrigger[] {
  switch (row.stage) {
    case "lead":
      return row.returning ? ["returning", "first_contact"] : ["first_contact"];
    case "contacted":
    case "proposal": {
      const call = row.lastCall;
      const talked = call && (call.outcome === "reached" || call.outcome === "call_back");
      return talked && time(call.occurredAt) > time(row.contact?.lastOutboundAt) ? ["after_call", "follow_up"] : ["follow_up"];
    }
    case "negotiation":
      return ["next_steps"];
    case "won":
      return ["confirmed"];
    case "lost":
      return ["declined"];
  }
}

/**
 * The template to suggest for a row: the first trigger in suggestedTriggers
 * that has a template; the sheet's own templates win over global ones, then
 * sort_order, then name. Null when none fits.
 */
export function suggestTemplate<T extends TemplateLike>(row: SuggestRow, templates: readonly T[]): T | null {
  for (const trigger of suggestedTriggers(row)) {
    const candidates = templates
      .filter((t) => t.trigger === trigger)
      .sort(
        (a, b) =>
          Number(a.projectId === null) - Number(b.projectId === null) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
    if (candidates[0]) return candidates[0];
  }
  return null;
}
