"use client";

/**
 * "Draft follow-up" panel for the contact page (owned by the Claude feature).
 * Button → generates a draft with Claude (server action) → editable subject/body,
 * account picker, "reply in thread" toggle → "Save to Gmail drafts" → link.
 */
export function DraftFollowUp(props: {
  contactId: string;
  /** Connected accounts that can save drafts. */
  accounts: { id: string; email: string }[];
  /** Whether the contact has any email address / history. */
  hasEmail: boolean;
}) {
  void props;
  return null;
}
