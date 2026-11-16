/**
 * How each status, tag and status filter of a booking sheet is set: shown in
 * the sheet's (i) info tips so the owner can see what is automatic and what
 * is set by hand. Keep in sync with the triggers in
 * supabase/migrations/20261116000000_email_stage.sql,
 * 20261116010000_bounces_auto_replies.sql and 20261116020000_email_status_guards.sql.
 */

export type HowSet = "auto" | "manual";

export interface Explained {
  label: string;
  how: HowSet;
  text: string;
}

export const STAGE_EXPLAINED: Explained[] = [
  { label: "To contact", how: "auto", text: "Nobody at this organization has ever received an email from us." },
  {
    label: "Contacted",
    how: "auto",
    text: "We emailed them and nobody at the organization has ever answered. Bounces and automatic replies don't count as answers. Rows marked Contacted from the old lists stay Contacted.",
  },
  {
    label: "Replied",
    how: "auto",
    text: "Someone at the organization answered at least once (even if the last email is ours). Writing to info@ and getting an answer from the director counts.",
  },
  { label: "Offer sent", how: "manual", text: "Set by hand when a concrete offer has been sent." },
  { label: "In conversation", how: "manual", text: "Set by hand while dates or terms are being discussed." },
  { label: "Confirmed", how: "manual", text: "Set by hand when the concert is agreed." },
  { label: "Declined", how: "manual", text: "Set by hand when they say no." },
];

export const STAGE_RULE =
  "To contact, Contacted and Replied are computed from the emails in every connected mailbox and can't be changed by hand (a manual change is undone). The status only moves up (To contact, Contacted, Replied), never down by itself. The other statuses are set by hand.";

export const TAGS_EXPLAINED: Explained[] = [
  { label: "Prestigious", how: "manual", text: "A place we really want to play. A curated organization tag; add or remove it on the organization." },
  { label: "< 5 h from NYC", how: "auto", text: "The city is about 5 hours or less by car from Midtown Manhattan (driving time without traffic), from the organization's city." },
  { label: "Chamber specialists", how: "auto", text: "Presents mainly chamber music or recitals, from the research (name, programming and profile)." },
  { label: "Returning", how: "manual", text: "We have played there before. Set by hand on the row." },
  { label: "Claude / ChatGPT", how: "auto", text: "Who researched the organization's profile (from the profile's researchedBy)." },
];

export const STATUS_EXPLAINED: Explained[] = [
  { label: "Has phone", how: "auto", text: "The row's contact has a phone or WhatsApp number." },
  { label: "Follow-up due", how: "manual", text: "The follow-up date you set on the row is today or earlier." },
  {
    label: "No reply (2+ months)",
    how: "auto",
    text: "Contacted, nobody ever answered, and our last email is more than 2 months old: time for a follow-up.",
  },
  {
    label: "Bounced email",
    how: "auto",
    text: "A delivery-failure notice (from mailer-daemon or postmaster, subjects like \"Delivery Status Notification (Failure)\", \"Undeliverable\", \"Mail delivery failed\") named this address within 14 days of our email. The address doesn't work: find a new one. The status doesn't change.",
  },
  {
    label: "Auto-reply",
    how: "auto",
    text: "After our last email they sent an automatic reply: Gmail's automatic flag, or a subject like \"Out of office\", \"Automatic reply\", \"Respuesta automática\", \"Automatische Antwort\", \"Réponse automatique\". It never counts as an answer; a real answer later makes the row Replied.",
  },
  { label: "Not researched", how: "auto", text: "The organization has no research profile yet." },
];

export const AUTO_LOCK_NOTE =
  "Automatic values are protected in the database: nobody (the app, ChatGPT or SQL) can change them by hand; only the email detectors do.";
