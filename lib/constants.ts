import type { ContactStatus, OpportunityKind, OpportunityStage, OrganizationKind } from "@/lib/types";

export const CONTACT_STATUSES: { value: ContactStatus; label: string; hint: string }[] = [
  { value: "new", label: "New", hint: "Auto-created from email, not reviewed yet" },
  { value: "lead", label: "Lead", hint: "Potential collaborator, client or funder" },
  { value: "active", label: "Active", hint: "Ongoing relationship" },
  { value: "inactive", label: "Inactive", hint: "Past relationship" },
  { value: "archived", label: "Archived", hint: "Hidden from lists and follow-ups" },
];

export const OPPORTUNITY_STAGES: { value: OpportunityStage; label: string; open: boolean }[] = [
  { value: "lead", label: "Lead", open: true },
  { value: "contacted", label: "Contacted", open: true },
  { value: "proposal", label: "Proposal", open: true },
  { value: "negotiation", label: "Negotiation", open: true },
  { value: "won", label: "Won", open: false },
  { value: "lost", label: "Lost", open: false },
];

export const OPEN_STAGES: OpportunityStage[] = OPPORTUNITY_STAGES.filter((s) => s.open).map((s) => s.value);

export const OPPORTUNITY_KINDS: { value: OpportunityKind; label: string }[] = [
  { value: "booking", label: "Booking" },
  { value: "fundraising", label: "Fundraising" },
  { value: "partnership", label: "Partnership" },
  { value: "grant", label: "Grant" },
  { value: "press", label: "Press" },
  { value: "sale", label: "Sale" },
  { value: "other", label: "Other" },
];

/** Stage names as they read for each kind of opportunity (same six stages underneath). */
export const STAGE_LABELS_BY_KIND: Record<OpportunityKind, Record<OpportunityStage, string>> = {
  booking: { lead: "Lead", contacted: "Contacted", proposal: "Offer sent", negotiation: "Negotiating", won: "Confirmed", lost: "Declined" },
  fundraising: { lead: "Prospect", contacted: "Cultivating", proposal: "Ask made", negotiation: "Negotiating", won: "Committed", lost: "Declined" },
  partnership: { lead: "Idea", contacted: "Contacted", proposal: "Proposal", negotiation: "Negotiating", won: "Partner", lost: "Declined" },
  grant: { lead: "Researching", contacted: "Contacted", proposal: "Submitted", negotiation: "Under review", won: "Awarded", lost: "Rejected" },
  press: { lead: "Pitch idea", contacted: "Pitched", proposal: "Interested", negotiation: "Scheduled", won: "Published", lost: "Passed" },
  sale: { lead: "Lead", contacted: "Contacted", proposal: "Quote sent", negotiation: "Negotiating", won: "Won", lost: "Lost" },
  other: { lead: "Lead", contacted: "Contacted", proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost" },
};

export function stageLabel(stage: OpportunityStage, kind: OpportunityKind = "other"): string {
  return STAGE_LABELS_BY_KIND[kind]?.[stage] ?? OPPORTUNITY_STAGES.find((s) => s.value === stage)?.label ?? stage;
}

export const ORGANIZATION_KINDS: { value: OrganizationKind; label: string; hint: string }[] = [
  { value: "venue", label: "Venue", hint: "Concert hall, chamber music hall, theater, festival" },
  { value: "funder", label: "Funder", hint: "Foundation, private donor, sponsor" },
  { value: "partner", label: "Partner", hint: "Co-producer, collaborator, brand partner" },
  { value: "press", label: "Press", hint: "Magazine, newspaper, radio, blog" },
  { value: "agency", label: "Agency", hint: "Booking or artist agency, PR agency" },
  { value: "institution", label: "Institution", hint: "School, university, museum, government" },
  { value: "other", label: "Other", hint: "" },
];

/** Project colors → Tailwind classes for the small dot / badge. */
export const PROJECT_COLORS: Record<string, { dot: string; badge: string }> = {
  gray: { dot: "bg-zinc-400", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  violet: { dot: "bg-violet-500", badge: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  blue: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  green: { dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  amber: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  rose: { dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
  teal: { dot: "bg-teal-500", badge: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300" },
  orange: { dot: "bg-orange-500", badge: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  pink: { dot: "bg-pink-500", badge: "bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300" },
};

export const PROJECT_COLOR_NAMES = Object.keys(PROJECT_COLORS);

/** Consumer mail domains: never used to auto-link a contact to an organization. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.fr",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "hotmail.fr",
  "hotmail.co.uk",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "fastmail.com",
  "hey.com",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "sfr.fr",
  "wanadoo.fr",
  "comcast.net",
  "verizon.net",
  "att.net",
  "qq.com",
  "163.com",
  "naver.com",
]);

/** Outbound messages with more recipients than this never auto-create contacts. */
export const MAX_RECIPIENTS_FOR_AUTO_CONTACTS = 20;

/** Days after which an unanswered outbound email counts as "awaiting reply". */
export const AWAITING_REPLY_DAYS = 7;

/** Reply lists ignore conversations older than this. */
export const REPLY_LOOKBACK_DAYS = 90;
