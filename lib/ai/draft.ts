import "server-only";

export interface FollowUpDraft {
  subject: string;
  body: string;
  /** Account suggested for sending: the one that last corresponded with the contact. */
  accountId: string | null;
  accountEmail: string | null;
  to: string[];
  /** messages.id of the latest message in the thread to reply to, if replying in thread. */
  replyToMessageId: string | null;
  /** Short explanation shown under the draft ("Following up on the June 3 invoice…"). */
  rationale: string;
}

/**
 * Generate a follow-up email for a contact from their recent history (bodies
 * of the last ~15 messages across accounts), notes, projects, open
 * opportunities and follow-up note. One structured-output call
 * (client.beta.messages.parse + betaZodOutputFormat). `instructions` lets the
 * owner steer ("mention the October show", "shorter", "in French").
 * Throws if the contact does not exist.
 */
export async function draftFollowUp(contactId: string, options: { instructions?: string } = {}): Promise<FollowUpDraft> {
  void contactId;
  void options;
  throw new Error("TODO");
}
