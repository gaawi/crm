/**
 * Promotion (the partners and outlets every concert is sent to): the
 * vocabulary shared by the page, the server actions, the assistant API and
 * the brief for an outside agent.
 */

export const PLATFORM_KINDS = [
  { value: "partner", label: "Partner", hint: "Sells or offers tickets to its members (TDF, Culture Pass)" },
  { value: "editorial", label: "Press", hint: "Editors and critics (Time Out, BroadwayWorld)" },
  { value: "calendar", label: "Calendar", hint: "Publishes the listing on its event calendar" },
  { value: "newsletter", label: "Newsletter", hint: "Curated picks sent to subscribers (The Skint)" },
  { value: "aggregator", label: "Aggregator", hint: "Copies events from other sites" },
  { value: "other", label: "Other", hint: "" },
] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number]["value"];

export const PLATFORM_TIERS = [
  { value: "always", label: "Every concert" },
  { value: "sometimes", label: "Some concerts" },
  { value: "skip", label: "Not worth it" },
] as const;
export type PlatformTier = (typeof PLATFORM_TIERS)[number]["value"];

export function kindLabel(kind: PlatformKind): string {
  return PLATFORM_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export const SUBMISSION_STATUSES = [
  { value: "todo", label: "To do", tone: "neutral" },
  { value: "sent", label: "Sent", tone: "info" },
  { value: "received", label: "Received", tone: "info" },
  { value: "published", label: "Published", tone: "success" },
  { value: "rejected", label: "Rejected", tone: "danger" },
  { value: "blocked", label: "Blocked", tone: "warning" },
  { value: "skipped", label: "Skipped", tone: "neutral" },
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]["value"];

export const SUBMISSION_STATUS_HINT: Record<SubmissionStatus, string> = {
  todo: "Not sent yet",
  sent: "Sent, no confirmation yet",
  received: "They confirmed receipt",
  published: "Listed: the public page is live",
  rejected: "They said no",
  blocked: "Could not send (captcha, login, payment…)",
  skipped: "Decided not to send",
};

export const LISTING_METHODS = [
  { value: "form", label: "Form" },
  { value: "email", label: "Email" },
  { value: "account", label: "Account" },
  { value: "other", label: "Other" },
] as const;
export type ListingMethod = (typeof LISTING_METHODS)[number]["value"];

export const LISTING_COSTS = [
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
  { value: "unknown", label: "Cost unknown" },
] as const;
export type ListingCost = (typeof LISTING_COSTS)[number]["value"];

export const DEFAULT_EVENT_TIME_ZONE = "America/New_York";

export function statusLabel(status: SubmissionStatus): string {
  return SUBMISSION_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function methodLabel(method: ListingMethod): string {
  return LISTING_METHODS.find((m) => m.value === method)?.label ?? method;
}

/** Statuses that count as done for a concert: nothing left to do on that platform. */
export const SETTLED_STATUSES: readonly SubmissionStatus[] = ["received", "published", "rejected", "skipped"];
