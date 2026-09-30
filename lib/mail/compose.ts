import { replySubject } from "@/lib/gmail/mime";
import type { Address } from "@/lib/types";

/**
 * Pure helpers of the composer (client- and server-safe): reply recipients,
 * subjects, quoted history and the forwarded-message block, recipient input
 * parsing. The quoted/forwarded text is appended at send time, never put in
 * the textarea.
 */

export type ComposeKind = "new" | "reply" | "reply_all" | "forward";

export interface ReplySource {
  from: Address | null;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  outbound: boolean;
  date: Date;
  subject: string | null;
  /** Full plain text of the message (with its own quoted history). */
  text: string | null;
}

export { replySubject };

const lower = (email: string) => email.trim().toLowerCase();

function uniqueAddresses(list: Address[], exclude: Set<string>): Address[] {
  const seen = new Set(exclude);
  const out: Address[] = [];
  for (const a of list) {
    const key = lower(a.email);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ email: key, name: a.name });
  }
  return out;
}

/**
 * Recipients of a reply, like Gmail: to the Reply-To (else the From) of the
 * message; replying to one of your own messages goes to its original To.
 * Reply all puts everyone else from To/Cc in Cc, minus your own addresses.
 */
export function replyRecipients(
  message: Pick<ReplySource, "from" | "to" | "cc" | "replyTo" | "outbound">,
  mode: "reply" | "reply_all",
  own: ReadonlySet<string>,
): { to: Address[]; cc: Address[] } {
  const ownSet = new Set([...own].map(lower));
  const isOwn = (a: Address) => ownSet.has(lower(a.email));
  let to: Address[];
  if (message.outbound) {
    const external = message.to.filter((a) => !isOwn(a));
    to = uniqueAddresses(external.length ? external : message.to, new Set());
  } else {
    const target = message.replyTo.length ? message.replyTo : message.from ? [message.from] : [];
    to = uniqueAddresses(target, new Set());
  }
  if (mode === "reply") return { to, cc: [] };
  const taken = new Set([...to.map((a) => lower(a.email)), ...ownSet]);
  // With a Reply-To, the original sender is one of the "others" too.
  const sender = !message.outbound && message.replyTo.length && message.from ? [message.from] : [];
  const others = message.outbound ? message.cc : [...sender, ...message.to, ...message.cc];
  return { to, cc: uniqueAddresses(others, taken) };
}

/** True when "Reply all" would reach more people than "Reply". */
export function hasReplyAll(message: Pick<ReplySource, "from" | "to" | "cc" | "replyTo" | "outbound">, own: ReadonlySet<string>): boolean {
  return replyRecipients(message, "reply_all", own).cc.length > 0;
}

/** "Fwd: Hello"; an existing "Fwd:" / "Fw:" prefix is kept. */
export function forwardSubject(subject: string | null): string {
  const text = (subject ?? "").replace(/\s+/g, " ").trim();
  if (/^(?:fwd?|fw)\s*:/i.test(text)) return text;
  return text ? `Fwd: ${text}` : "Fwd:";
}

export function composeSubject(kind: ComposeKind, subject: string | null): string {
  if (kind === "reply" || kind === "reply_all") return replySubject(subject);
  if (kind === "forward") return forwardSubject(subject);
  return subject ?? "";
}

/** "Maya Chen <maya@x.org>" or "maya@x.org". */
export function formatAddress(address: Address): string {
  const name = address.name?.replace(/[\r\n"<>]+/g, " ").trim();
  return name && name.toLowerCase() !== address.email.toLowerCase() ? `${name} <${address.email}>` : address.email;
}

/** "Tue, Sep 30, 2026 at 3:04 PM" (Gmail's quote header date). */
export function formatQuoteDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("month")} ${get("day")}, ${get("year")} at ${get("hour")}:${get("minute")} ${get("dayPeriod")}`.trim();
}

/** "On Tue, Sep 30, 2026 at 3:04 PM, Maya Chen <maya@x.org> wrote:" */
export function quoteHeader(message: Pick<ReplySource, "from" | "date">, timeZone: string): string {
  const who = message.from ? formatAddress(message.from) : "someone";
  return `On ${formatQuoteDate(message.date, timeZone)}, ${who} wrote:`;
}

/** Every line prefixed with "> " (">" for empty lines), trailing blank lines dropped. */
export function quoteLines(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  return lines.map((line) => (line.trim() ? `> ${line}` : ">")).join("\n");
}

const MAX_QUOTED_CHARS = 100_000;

export function replyQuote(message: Pick<ReplySource, "from" | "date" | "text">, timeZone: string): string {
  const text = (message.text ?? "").slice(0, MAX_QUOTED_CHARS);
  return `${quoteHeader(message, timeZone)}\n${quoteLines(text)}`;
}

/** Gmail's forwarded-message block (headers + the original text). */
export function forwardBlock(message: ReplySource, timeZone: string): string {
  const lines = [
    "---------- Forwarded message ---------",
    `From: ${message.from ? formatAddress(message.from) : ""}`,
    `Date: ${formatQuoteDate(message.date, timeZone)}`,
    `Subject: ${message.subject ?? ""}`,
    `To: ${message.to.map(formatAddress).join(", ")}`,
  ];
  if (message.cc.length) lines.push(`Cc: ${message.cc.map(formatAddress).join(", ")}`);
  return `${lines.join("\n")}\n\n${(message.text ?? "").slice(0, MAX_QUOTED_CHARS).replace(/\s+$/, "")}`;
}

/** What is actually sent: the typed body, then the quote/forward block when included. */
export function outgoingBody(body: string, appendix: string | null, include: boolean): string {
  const typed = body.replace(/\s+$/, "");
  if (!appendix || !include) return typed;
  return typed ? `${typed}\n\n${appendix}` : appendix;
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function isLikelyEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * Addresses typed or pasted into a recipient field: "a@x.com, B <b@y.org>;
 * c@z.io". Invalid pieces are returned separately so the field can keep them.
 */
export function parseRecipientInput(input: string): { addresses: Address[]; rest: string } {
  const addresses: Address[] = [];
  const rest: string[] = [];
  const pieces = input.match(/(?:"[^"]*"|<[^>]*>|[^,;\n])+/g) ?? [];
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;
    const angle = /^(.*)<([^>]+)>\s*$/.exec(piece);
    const email = (angle ? angle[2] : piece).trim().replace(/^mailto:/i, "");
    const name = angle ? angle[1].trim().replace(/^"|"$/g, "").trim() || null : null;
    if (isLikelyEmail(email)) addresses.push({ email: email.toLowerCase(), name });
    else rest.push(piece);
  }
  return { addresses, rest: rest.join(", ") };
}
