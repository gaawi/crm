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
  { label: "Confirmed", how: "manual", text: "Set by hand when the concert is agreed." },
  { label: "Declined", how: "manual", text: "Set by hand when they say no." },
];

export const STAGE_RULE =
  "To contact, Contacted and Replied are computed from the emails in every connected mailbox and can't be changed by hand (a manual change is undone). The status only moves up (To contact, Contacted, Replied), never down by itself. The other statuses are set by hand.";

export const TAGS_EXPLAINED: Explained[] = [
  { label: "Prestigious", how: "manual", text: "A place we really want to play. A curated organization tag; add or remove it on the organization." },
  {
    label: "In NYC",
    how: "auto",
    text: "The organization is in New York City (Manhattan, Brooklyn, the Bronx, Queens, Staten Island), from its city. Not a touring date: no fee pitch and no mass booking email; we look for co-productions or the use of the hall.",
  },
  {
    label: "Tour: Northwest",
    how: "manual",
    text: "Part of the 2028-29 Pacific Northwest tour around the Smith Fine Arts Series (Monmouth, OR): presenters within reach for block booking. Tag tour-northwest on the organization.",
  },
  {
    label: "Tour: Midwest",
    how: "manual",
    text: "Part of the 2028-29 Upper Midwest tour around Matinee Musicale (Duluth, MN): Minnesota, Wisconsin, Chicago, Iowa and the Dakotas. Tag tour-midwest on the organization.",
  },
  {
    label: "Rental only",
    how: "manual",
    text: "The hall doesn't present its own concerts: artists rent it. Set from the research or by hand on the organization. Useful for our own NYC concerts; never a booking pitch.",
  },
  { label: "< 5 h from NYC", how: "auto", text: "The city is about 5 hours or less by car from Midtown Manhattan (driving time without traffic), from the organization's city. Venues in New York City itself get In NYC instead." },
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

const STAGE_BY_VALUE: Record<string, string> = {
  lead: "To contact",
  contacted: "Contacted",
  replied: "Replied",
  proposal: "Offer sent",
  negotiation: "In conversation",
  won: "Confirmed",
  lost: "Declined",
};

/** How one status is set (for the (i) next to its pill). */
export function explainStage(stage: string): Explained | undefined {
  return STAGE_EXPLAINED.find((e) => e.label === STAGE_BY_VALUE[stage]);
}

const FLAG_LABEL: Record<string, string> = {
  vip: "Prestigious",
  nyc: "In NYC",
  tour_nw: "Tour: Northwest",
  tour_mw: "Tour: Midwest",
  rental: "Rental only",
  near_nyc: "< 5 h from NYC",
  chamber: "Chamber specialists",
  returning: "Returning",
  claude: "Claude / ChatGPT",
  chatgpt: "Claude / ChatGPT",
  phone: "Has phone",
  due: "Follow-up due",
  no_reply: "No reply (2+ months)",
  bounced: "Bounced email",
  auto_reply: "Auto-reply",
  unresearched: "Not researched",
};

/** How one tag or status filter is set (for the (i) next to its pill). */
export function explainFlag(flag: string): Explained | undefined {
  const label = FLAG_LABEL[flag];
  return [...TAGS_EXPLAINED, ...STATUS_EXPLAINED].find((e) => e.label === label);
}
