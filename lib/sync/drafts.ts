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
