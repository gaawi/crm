import type {
  ActivityKind,
  CallOutcome,
  ContactStatus,
  GoalGroup,
  NextAction,
  OpportunityKind,
  OpportunityStage,
  OrganizationKind,
  TemplateTrigger,
} from "@/lib/types";

export const CONTACT_STATUSES: { value: ContactStatus; label: string; hint: string }[] = [
  { value: "new", label: "New", hint: "Auto-created from email, not reviewed yet" },
  { value: "lead", label: "Lead", hint: "Potential collaborator, client or funder" },
  { value: "active", label: "Active", hint: "Ongoing relationship" },
  { value: "inactive", label: "Inactive", hint: "Past relationship" },
  { value: "archived", label: "Archived", hint: "Hidden from lists and follow-ups" },
];

/** Labels are the generic ones (lists that mix goal kinds); stageLabel(stage, kind) names them per kind. */
export const OPPORTUNITY_STAGES: { value: OpportunityStage; label: string; open: boolean }[] = [
  { value: "lead", label: "To contact", open: true },
  { value: "contacted", label: "Contacted", open: true },
  { value: "proposal", label: "Proposal sent", open: true },
  { value: "negotiation", label: "In conversation", open: true },
  { value: "won", label: "Achieved", open: false },
  { value: "lost", label: "Declined", open: false },
];

export const OPEN_STAGES: OpportunityStage[] = OPPORTUNITY_STAGES.filter((s) => s.open).map((s) => s.value);

/* Goals --------------------------------------------------------------------- */

export const GOAL_GROUPS: { value: GoalGroup; label: string }[] = [
  { value: "performances", label: "Performances" },
  { value: "support", label: "Support" },
  { value: "partnerships", label: "Partnerships" },
  { value: "visibility", label: "Visibility" },
  { value: "other", label: "Other" },
];

/**
 * Goal kinds: what we want from a contact / organization. An opportunity is
 * "a goal with someone"; a contact can have several. In the UI the word is
 * "Goal" (the Pipeline page keeps its name). Ordered by group.
 */
export const GOAL_KINDS: { value: OpportunityKind; label: string; hint: string; group: GoalGroup }[] = [
  { value: "booking", label: "Get booked", hint: "A paid concert or show", group: "performances" },
  { value: "perform_with", label: "Perform together", hint: "Play with their artists or ensemble", group: "performances" },
  { value: "residency", label: "Residency", hint: "A creation or artist residency", group: "performances" },
  { value: "education", label: "Workshop / masterclass", hint: "Teaching, outreach, school concerts", group: "performances" },
  { value: "broadcast", label: "Broadcast / recording", hint: "Radio, TV, streaming, a recording", group: "performances" },
  { value: "venue", label: "Use of a space", hint: "They lend or cede the hall or space", group: "support" },
  { value: "exchange", label: "Exchange", hint: "A concert for lodging, meals or travel", group: "support" },
  { value: "fundraising", label: "Donation", hint: "A private donor or patron", group: "support" },
  { value: "sponsorship", label: "Sponsorship", hint: "A company sponsors in money or in kind", group: "support" },
  { value: "grant", label: "Grant", hint: "Public or foundation funding", group: "support" },
  { value: "partnership", label: "Collaboration", hint: "Work together on a project", group: "partnerships" },
  { value: "coproduction", label: "Co-production / commission", hint: "They co-produce or commission a work", group: "partnerships" },
  { value: "network", label: "Join a circuit or catalogue", hint: "E.g. Asturies Cultura en Rede", group: "partnerships" },
  { value: "introduction", label: "Introduction", hint: "To someone they know", group: "partnerships" },
  { value: "press", label: "Press coverage", hint: "An article, interview or review in their outlet", group: "visibility" },
  { value: "sale", label: "Sale", hint: "Tickets, recordings, merchandise", group: "other" },
  { value: "other", label: "Other", hint: "", group: "other" },
];

/** Same list as GOAL_KINDS (kept for existing callers). */
export const OPPORTUNITY_KINDS = GOAL_KINDS;

/** "Get booked". */
export function goalLabel(kind: OpportunityKind | null | undefined): string {
  return GOAL_KINDS.find((k) => k.value === kind)?.label ?? "Other";
}

type StageLabels = Record<OpportunityStage, string>;

/** For lists that mix goal kinds. */
export const GENERIC_STAGE_LABELS: StageLabels = {
  lead: "To contact",
  contacted: "Contacted",
  proposal: "Proposal sent",
  negotiation: "In conversation",
  won: "Achieved",
  lost: "Declined",
};

const agreed = (proposal = "Proposal sent"): StageLabels => ({ ...GENERIC_STAGE_LABELS, proposal, won: "Agreed" });

/** Stage names as they read for each goal kind (same six stages underneath). */
export const STAGE_LABELS_BY_KIND: Record<OpportunityKind, StageLabels> = {
  booking: { lead: "To contact", contacted: "Contacted", proposal: "Offer sent", negotiation: "In conversation", won: "Confirmed", lost: "Declined" },
  perform_with: agreed(),
  residency: agreed("Application sent"),
  education: agreed(),
  broadcast: agreed(),
  venue: { lead: "To ask", contacted: "Asked", proposal: "Request sent", negotiation: "In conversation", won: "Granted", lost: "Declined" },
  exchange: agreed(),
  fundraising: { lead: "Prospect", contacted: "Contacted", proposal: "Ask made", negotiation: "In conversation", won: "Donated", lost: "Declined" },
  sponsorship: { lead: "Prospect", contacted: "Contacted", proposal: "Proposal sent", negotiation: "In conversation", won: "Sponsored", lost: "Declined" },
  grant: { lead: "To apply", contacted: "Contacted", proposal: "Applied", negotiation: "Under review", won: "Awarded", lost: "Rejected" },
  partnership: agreed(),
  coproduction: agreed(),
  network: agreed("Application sent"),
  introduction: { lead: "To ask", contacted: "Asked", proposal: "Details sent", negotiation: "In conversation", won: "Introduced", lost: "Declined" },
  press: { lead: "To pitch", contacted: "Pitched", proposal: "Materials sent", negotiation: "In conversation", won: "Published", lost: "Declined" },
  sale: { lead: "Lead", contacted: "Contacted", proposal: "Quote sent", negotiation: "Negotiating", won: "Sold", lost: "Lost" },
  other: GENERIC_STAGE_LABELS,
};

/** The stage as it reads for a goal kind; no kind (null) = the generic labels for mixed lists. */
export function stageLabel(stage: OpportunityStage, kind: OpportunityKind | null = null): string {
  return (kind ? STAGE_LABELS_BY_KIND[kind] : GENERIC_STAGE_LABELS)?.[stage] ?? GENERIC_STAGE_LABELS[stage] ?? stage;
}

/**
 * The kind whose stage labels a list of rows should use: the shared kind when
 * every row has the same one (no rows = booking, for a booking sheet), else
 * null (generic labels; pass it to stageLabel).
 */
export function labelKindFor(kinds: readonly OpportunityKind[], fallback: OpportunityKind | null = "booking"): OpportunityKind | null {
  const distinct = [...new Set(kinds)];
  if (!distinct.length) return fallback;
  return distinct.length === 1 ? distinct[0] : null;
}

/* Next steps ---------------------------------------------------------------- */

/**
 * The structured next step of a goal. `icon` is a lucide-react component
 * name. Shown as "<icon> <label> · <detail> · <date>" (detail = next_step,
 * date = follow_up_at; both optional).
 */
export const NEXT_ACTIONS: { value: NextAction; label: string; icon: string }[] = [
  { value: "first_contact", label: "Make first contact", icon: "Handshake" },
  { value: "call", label: "Call", icon: "Phone" },
  { value: "send_proposal", label: "Send full proposal", icon: "FileText" },
  { value: "send_materials", label: "Send dossier / video", icon: "Clapperboard" },
  { value: "follow_up", label: "Follow up", icon: "Reply" },
  { value: "meeting", label: "Meeting / video call", icon: "Video" },
  { value: "agree_terms", label: "Agree dates & fee", icon: "CalendarCheck" },
  { value: "send_contract", label: "Send contract", icon: "FilePen" },
  { value: "close_contract", label: "Sign the contract", icon: "Signature" },
  { value: "logistics", label: "Plan logistics", icon: "Truck" },
  { value: "invoice", label: "Invoice", icon: "Receipt" },
  { value: "thank_report", label: "Thank & share photos", icon: "Heart" },
  { value: "keep_informed", label: "Keep informed of our news", icon: "Megaphone" },
  { value: "wait_reply", label: "Wait for their reply", icon: "Hourglass" },
];

export function nextActionLabel(action: NextAction | null | undefined): string | null {
  return action ? (NEXT_ACTIONS.find((a) => a.value === action)?.label ?? null) : null;
}

/**
 * The text parts of a next step, for "<icon> <label> · <detail> · <date>":
 * label (null when no action), detail, and the due date as given
 * ('YYYY-MM-DD'; format it with formatDue / formatDate). `text` joins the
 * label and detail with " · " (empty when neither is set).
 */
export function nextStepParts(goal: { nextAction: NextAction | null; nextStep: string | null; followUpAt: string | null }): {
  action: NextAction | null;
  label: string | null;
  icon: string | null;
  detail: string | null;
  date: string | null;
  text: string;
} {
  const meta = goal.nextAction ? NEXT_ACTIONS.find((a) => a.value === goal.nextAction) : undefined;
  const detail = goal.nextStep?.trim() || null;
  const label = meta?.label ?? null;
  return {
    action: meta?.value ?? null,
    label,
    icon: meta?.icon ?? null,
    detail,
    date: goal.followUpAt || null,
    text: [label, detail].filter(Boolean).join(" · "),
  };
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

/* Booking tracker ---------------------------------------------------------- */

/** After an unanswered email: wait this many days before following up… */
export const FOLLOW_UP_WAIT_DAYS = 5;
/** …and after this many it is overdue ("No reply"). */
export const FOLLOW_UP_OVERDUE_DAYS = 10;

/** `past` reads in a "last touch" line: "Called 3 days ago". */
export const ACTIVITY_KINDS: { value: ActivityKind; label: string; past: string }[] = [
  { value: "call", label: "Call", past: "Called" },
  { value: "whatsapp", label: "WhatsApp", past: "WhatsApp" },
  { value: "meeting", label: "Meeting", past: "Met" },
  { value: "email", label: "Email (logged by hand)", past: "Emailed" },
  { value: "note", label: "Note", past: "Note" },
  { value: "status", label: "Status change", past: "Status changed" },
];

export const CALL_OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: "reached", label: "Talked" },
  { value: "no_answer", label: "No answer" },
  { value: "voicemail", label: "Voicemail" },
  { value: "call_back", label: "Call back" },
  { value: "wrong_number", label: "Wrong number" },
];

export const TEMPLATE_TRIGGERS: { value: TemplateTrigger; label: string; hint: string }[] = [
  { value: "first_contact", label: "First contact", hint: "To contact, never worked together (or next step: send full proposal)" },
  { value: "returning", label: "Returning venue", hint: "To contact, worked together before" },
  { value: "follow_up", label: "Follow-up (no reply)", hint: "Contacted or offer sent, no answer yet (or next step: follow up / wait for their reply)" },
  { value: "after_call", label: "After a call", hint: "Contacted or offer sent, you talked on the phone since your last email" },
  { value: "next_steps", label: "Next steps (in conversation)", hint: "In conversation (or next step: agree dates & fee, contract)" },
  { value: "confirmed", label: "Confirmed — logistics", hint: "Confirmed (or next step: plan logistics)" },
  { value: "declined", label: "Declined — thanks", hint: "Declined" },
  { value: "keep_informed", label: "Keep informed — news", hint: "Next step: keep informed of our news" },
  { value: "thanks", label: "Thanks after the event", hint: "Next step: thank & share photos" },
  { value: "custom", label: "Manual only", hint: "Never suggested; pick it by hand" },
];

/** Placeholders an email template may use. */
export const TEMPLATE_VARIABLES: { name: string; label: string; example: string }[] = [
  { name: "first_name", label: "Contact's first name", example: "Ana" },
  { name: "contact_name", label: "Contact's full name", example: "Ana López" },
  { name: "venue", label: "Venue / presenter", example: "Teatro Campoamor" },
  { name: "city", label: "City", example: "Oviedo" },
  { name: "spaces", label: "Halls / spaces", example: "Sala principal" },
  { name: "dates", label: "Dates", example: "Spring 2027" },
  { name: "fee", label: "Fee", example: "4500 €" },
  { name: "sheet", label: "Sheet name", example: "Gira España 2027" },
  { name: "my_name", label: "Your name (Settings)", example: "Guillermo" },
  { name: "signature", label: "Your signature (Settings)", example: "Guillermo Laporta · CreArtBox" },
];
