import "server-only";

/**
 * Save an email as a Gmail draft in a connected account (never sends).
 * When replyToMessageId is given (a messages.id), the draft replies in that
 * message's thread: same Gmail threadId (only if the message belongs to the
 * same account; otherwise a new thread), In-Reply-To/References headers, and
 * "Re: <subject>" unless a subject is given. From = the account's address.
 * Returns the draft id and a URL that opens it in Gmail.
 */
export async function saveGmailDraft(params: {
  accountId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string | null;
}): Promise<{ draftId: string; gmailUrl: string }> {
  void params;
  throw new Error("TODO");
}

/** Replace the content of an existing Gmail draft (drafts.update), keeping its thread. */
export async function updateGmailDraft(params: {
  accountId: string;
  draftId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string | null;
}): Promise<{ draftId: string; gmailUrl: string }> {
  void params;
  throw new Error("TODO");
}

/** Send an existing Gmail draft (drafts.send). Returns the sent message's Gmail ids. */
export async function sendGmailDraft(accountId: string, draftId: string): Promise<{ gmailMessageId: string; gmailThreadId: string }> {
  void accountId;
  void draftId;
  throw new Error("TODO");
}

/** Delete a Gmail draft (drafts.delete) — best effort, never throws on 404. */
export async function deleteGmailDraft(accountId: string, draftId: string): Promise<void> {
  void accountId;
  void draftId;
  throw new Error("TODO");
}

/** Drafts currently in the account's Gmail (drafts.list + metadata), newest first. */
export async function listGmailDrafts(accountId: string, options: { limit?: number } = {}): Promise<
  { draftId: string; gmailMessageId: string; gmailThreadId: string; to: string[]; subject: string; snippet: string; updatedAt: Date | null }[]
> {
  void accountId;
  void options;
  throw new Error("TODO");
}
