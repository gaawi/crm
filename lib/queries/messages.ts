import "server-only";
import type { ContactRef, Direction, EmailMessage } from "@/lib/types";

export interface MessageSearch {
  /** websearch_to_tsquery('english', q) against messages.search; optional when other filters are given. */
  q?: string;
  since?: Date;
  until?: Date;
  accountId?: string;
  direction?: Direction;
  contactId?: string;
  organizationId?: string;
  includeAutomated?: boolean;
  limit?: number;
}

export interface MessageHit extends EmailMessage {
  /** ts_rank; 0 when no q. */
  rank: number;
  /** Contacts involved in the message (any role). */
  contacts: ContactRef[];
}

/** Full-text search, de-duplicated across accounts. Ordered by rank then date when q is given, else by date. */
export async function searchMessages(search: MessageSearch): Promise<MessageHit[]> {
  void search;
  throw new Error("TODO");
}

export async function getMessage(id: string): Promise<EmailMessage | null> {
  void id;
  throw new Error("TODO");
}

/** All messages of a Gmail thread in one account, oldest first. */
export async function getThread(accountId: string, gmailThreadId: string): Promise<EmailMessage[]> {
  void accountId;
  void gmailThreadId;
  throw new Error("TODO");
}

/** Latest non-automated messages across all accounts with the main contact of each (sender for inbound, first recipient for outbound). */
export async function recentActivity(limit = 20): Promise<(EmailMessage & { contact: ContactRef | null })[]> {
  void limit;
  throw new Error("TODO");
}

export async function countMessages(): Promise<number> {
  throw new Error("TODO");
}
