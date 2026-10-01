import type { Address } from "@/lib/types";
import type { ParsedMessage } from "@/lib/gmail/types";
import { isNoReplyAddress } from "@/lib/gmail/parse";
import { MAX_RECIPIENTS_FOR_AUTO_CONTACTS } from "@/lib/constants";

/** Longest display name kept for a contact. */
const MAX_NAME_CHARS = 200;

/**
 * Automated reasons that mark real mailing lists / bulk mail. A no-reply
 * sender's Reply-To never becomes a contact when one of these applies.
 */
const LIST_REASONS = new Set(["list_id", "precedence", "unsubscribe"]);

/** Sending subdomains of bulk / transactional email services (email.shopify.com, messages.tax.ny.gov…). */
const BULK_SUBDOMAIN_RE =
  /^(?:e|em|email|emails|mailer|mailers|messages?|notifications?|notify|news|newsletters?|communications?|welcome|organizer|alerts?|updates?|marketing|mkt|mg|info|txn|transactional)$/;

/** Bulk-mail, opt-out and transactional platforms whose addresses are never people. */
const MACHINE_DOMAIN_RE =
  /(?:^|\.)(?:hubspotemail\.net|customer\.io|sendgrid\.net|mcsv\.net|mailchimpapp\.net|mandrillapp\.com|amazonses\.com|sparkpostmail\.com|medallia\.com|paypal\.com|amazon\.com|americanexpress\.com|stripe\.com|shopify\.com|usbank\.com|eventbrite\.com|intuit\.com|squareup\.com|venmo\.com|zelle\.com|surepayroll\.com|docusign\.net|linkedin\.com|facebookmail\.com)$/;

/** Role mailboxes that send receipts, alerts and statements rather than conversations. */
const MACHINE_LOCAL_RE =
  /^(?:service|services|billing|account|accounts|account-update|accountupdate|shipment-tracking|tracking|notifications?|notice|alerts?|mailer|flow|payables|payments?|invoices?|receipts?|statements?|orders?|order-update|auto-confirm|confirm|verify|security|digest|newsletters?|updates|marketing|help|support|unsubscribe)$/;

/**
 * Addresses that belong to machines, not people: bulk-mail sending domains,
 * transactional senders (receipts, alerts), VERP / opt-out tokens such as the
 * mailto: targets Gmail writes to when you click "Unsubscribe".
 */
export function isMachineAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (MACHINE_DOMAIN_RE.test(domain)) return true;
  if (/=|unsub|opt-?out/.test(local)) return true;
  if (MACHINE_LOCAL_RE.test(local.split("+")[0])) return true;
  const labels = domain.split(".");
  return labels.length >= 3 && BULK_SUBDOMAIN_RE.test(labels[0]);
}

/** Same rule as the DB check on contact_emails / message_participants: lower-case, "@" after the first character, no whitespace. */
export function isStorableEmail(email: string | null | undefined): email is string {
  if (typeof email !== "string" || email === "") return false;
  return email === email.toLowerCase() && email.indexOf("@") > 0 && !/\s/.test(email);
}

function normalized(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const value = email.trim().toLowerCase();
  return isStorableEmail(value) ? value : null;
}

/**
 * Which addresses of a message should become contacts if unknown.
 * - never self addresses, no-reply or machine addresses (isMachineAddress), invalid ones
 * - outbound: to/cc/bcc, unless > MAX_RECIPIENTS_FOR_AUTO_CONTACTS recipients
 * - inbound: the sender, only when the message is not automated
 * - inbound from a no-reply sender with a real Reply-To (contact forms): the
 *   Reply-To address, unless the message is a mailing list (List-Id,
 *   List-Unsubscribe or Precedence bulk)
 * Returns unique addresses (first display name wins).
 */
export function selectContactCandidates(message: ParsedMessage, selfEmails: ReadonlySet<string>): Address[] {
  const out = new Map<string, Address>();
  const add = (address: Address | null | undefined) => {
    const email = normalized(address?.email);
    if (!email || selfEmails.has(email) || isNoReplyAddress(email) || isMachineAddress(email)) return;
    const name = cleanDisplayName(address?.name, email);
    const existing = out.get(email);
    if (!existing) out.set(email, { email, name });
    else if (!existing.name && name) existing.name = name;
  };

  if (message.direction === "outbound") {
    // Gmail's own one-click "Unsubscribe" emails are not conversations.
    if (/^\s*unsubscribe\b/i.test(message.subject ?? "")) return [];
    const recipients = new Set<string>();
    for (const address of [...message.to, ...message.cc, ...message.bcc]) {
      const email = normalized(address?.email);
      if (email && !selfEmails.has(email)) recipients.add(email);
    }
    if (recipients.size > MAX_RECIPIENTS_FOR_AUTO_CONTACTS) return [];
    for (const address of [...message.to, ...message.cc, ...message.bcc]) add(address);
    return [...out.values()];
  }

  const sender = normalized(message.from?.email);
  if (!message.isAutomated) add(message.from);

  if (sender && isNoReplyAddress(sender) && !LIST_REASONS.has(message.automatedReason ?? "")) {
    for (const address of message.replyTo) {
      const email = normalized(address?.email);
      if (email && email !== sender) add(address);
    }
  }
  return [...out.values()];
}

/**
 * Every participant (self included) with its role, for message_participants
 * rows; de-duplicated per (role, email). Reply-To addresses are included only
 * when they differ from the sender. Addresses that would violate the DB check
 * are dropped.
 */
export function participantRows(
  message: ParsedMessage,
): { role: "from" | "to" | "cc" | "bcc" | "reply_to"; email: string; name: string | null }[] {
  type Role = "from" | "to" | "cc" | "bcc" | "reply_to";
  const rows: { role: Role; email: string; name: string | null }[] = [];
  const seen = new Set<string>();
  const push = (role: Role, address: Address | null | undefined) => {
    const email = normalized(address?.email);
    if (!email) return;
    const key = `${role}\u0000${email}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ role, email, name: cleanDisplayName(address?.name, email) });
  };

  push("from", message.from);
  for (const address of message.to) push("to", address);
  for (const address of message.cc) push("cc", address);
  for (const address of message.bcc) push("bcc", address);
  const sender = normalized(message.from?.email);
  for (const address of message.replyTo) {
    if (normalized(address?.email) !== sender) push("reply_to", address);
  }
  return rows;
}

/** Clean a header display name: strip quotes/whitespace; null when it is just the address or empty. */
export function cleanDisplayName(name: string | null | undefined, email: string): string | null {
  if (typeof name !== "string") return null;
  let value = name
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (;;) {
    const stripped = value.replace(/^["'`\s]+|["'`\s]+$/g, "").trim();
    if (stripped === value) break;
    value = stripped;
  }
  if (!value) return null;
  const address = email.trim().toLowerCase();
  const bare = value.replace(/^<|>$/g, "").trim().toLowerCase();
  if (bare === address || bare === `mailto:${address}`) return null;
  // "jane@x.com via Squarespace" style names are kept; a lone other address is not a name.
  if (/^[^\s@]+@[^\s@]+$/.test(bare)) return null;
  if (value.length > MAX_NAME_CHARS) value = value.slice(0, MAX_NAME_CHARS).trimEnd();
  return value;
}
