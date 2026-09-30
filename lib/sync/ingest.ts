import "server-only";
import type { ParsedMessage } from "@/lib/gmail/types";

export interface IngestResult {
  /** Rows inserted or updated. */
  stored: number;
  contactsCreated: number;
  /** Contacts whose stats were refreshed. */
  contactIds: string[];
}

/**
 * Store a batch of parsed messages for one account, in one transaction:
 * 1. upsert messages on (account_id, gmail_message_id) (labels/body refreshed);
 * 2. replace their message_participants rows;
 * 3. create contacts for unknown candidate addresses (rules.selectContactCandidates),
 *    under pg_advisory_xact_lock so concurrent runs never duplicate a contact;
 *    link each new contact to the organization whose domains contain its domain
 *    (never for FREE_MAIL_DOMAINS); fill empty names from display names;
 * 4. refresh_contact_stats for every contact owning any participant address.
 */
export async function ingestMessages(
  accountId: string,
  messages: ParsedMessage[],
  selfEmails: ReadonlySet<string>,
): Promise<IngestResult> {
  void accountId;
  void messages;
  void selfEmails;
  throw new Error("TODO");
}

/** Delete by Gmail id and refresh stats of affected contacts. Returns rows deleted. */
export async function deleteMessages(accountId: string, gmailMessageIds: string[]): Promise<number> {
  void accountId;
  void gmailMessageIds;
  throw new Error("TODO");
}

/** Which of these Gmail ids are already stored for the account. */
export async function existingMessageIds(accountId: string, gmailMessageIds: string[]): Promise<Set<string>> {
  void accountId;
  void gmailMessageIds;
  throw new Error("TODO");
}
