import type { Address } from "@/lib/types";
import type { ParsedMessage } from "@/lib/gmail/types";

/**
 * Which addresses of a message should become contacts if unknown.
 * - never self addresses, never no-reply style addresses, never invalid ones
 * - outbound: to/cc/bcc, unless > MAX_RECIPIENTS_FOR_AUTO_CONTACTS recipients
 * - inbound: the sender, only when the message is not automated
 * Returns unique addresses (first display name wins).
 */
export function selectContactCandidates(message: ParsedMessage, selfEmails: ReadonlySet<string>): Address[] {
  void message;
  void selfEmails;
  throw new Error("TODO");
}

/**
 * Every participant (self included) with its role, for message_participants
 * rows; de-duplicated per (role, email).
 */
export function participantRows(
  message: ParsedMessage,
): { role: "from" | "to" | "cc" | "bcc"; email: string; name: string | null }[] {
  void message;
  throw new Error("TODO");
}

/** Clean a header display name: strip quotes/whitespace; null when it is just the address or empty. */
export function cleanDisplayName(name: string | null | undefined, email: string): string | null {
  void name;
  void email;
  throw new Error("TODO");
}
