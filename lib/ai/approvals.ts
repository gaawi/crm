import "server-only";
import { sql } from "@/lib/db";
import { draftFollowUp, reviseEmail } from "@/lib/ai/draft";
import { getContact } from "@/lib/queries/contacts";
import { getDraft, insertDraft, pushRevision, transitionDraft, updateDraft } from "@/lib/queries/drafts";
import { deleteGmailDraft, saveGmailDraft, sendGmailDraft, updateGmailDraft } from "@/lib/sync/drafts";
import type { DraftOrigin, DraftPurpose, EmailDraft } from "@/lib/types";
import { errorMessage, isValidEmail, normalizeEmail } from "@/lib/utils";

/**
 * The approval queue: every email Claude prepares becomes an email_drafts row
 * plus a real Gmail draft. Nothing is sent until the owner approves it.
 */

export class DraftError extends Error {}

/** Addresses Claude may write to for a proposal: the contact's own + everyone in the replied thread. */
async function allowedRecipients(contactId: string | null, replyToMessageId: string | null): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (contactId) {
    const contact = await getContact(contactId);
    contact?.emails.forEach((e) => allowed.add(e));
  }
  if (replyToMessageId) {
    const rows = await sql<{ email: string }[]>`
      select distinct mp.email
        from messages m
        join messages t on t.account_id = m.account_id and t.gmail_thread_id = m.gmail_thread_id
        join message_participants mp on mp.message_id = t.id
       where m.id = ${replyToMessageId}
    `;
    rows.forEach((r) => allowed.add(r.email));
  }
  return allowed;
}

/** Account that last corresponded with the contact (active), else the first active account. */
async function pickAccount(contactId: string | null, replyToMessageId: string | null): Promise<string> {
  if (replyToMessageId) {
    const [row] = await sql<{ accountId: string }[]>`
      select m.account_id from messages m join gmail_accounts a on a.id = m.account_id and a.status = 'active'
       where m.id = ${replyToMessageId}`;
    if (row) return row.accountId;
  }
  if (contactId) {
    const [row] = await sql<{ accountId: string }[]>`
      select m.account_id
        from contact_emails ce
        join message_participants mp on mp.email = ce.email
        join messages m on m.id = mp.message_id
        join gmail_accounts a on a.id = m.account_id and a.status = 'active'
       where ce.contact_id = ${contactId}
       order by m.sent_at desc limit 1`;
    if (row) return row.accountId;
  }
  const [row] = await sql<{ id: string }[]>`select id from gmail_accounts where status = 'active' order by created_at limit 1`;
  if (!row) throw new DraftError("Connect a Gmail account first.");
  return row.id;
}

function cleanList(values: string[] | undefined): string[] {
  const out: string[] = [];
  for (const v of values ?? []) {
    const e = normalizeEmail(v);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

export interface ProposeInput {
  contactId?: string | null;
  accountId?: string | null;
  to?: string[];
  cc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string | null;
  opportunityId?: string | null;
  purpose?: DraftPurpose;
  origin: DraftOrigin;
  rationale?: string | null;
  /**
   * Claude-originated proposals may only address the contact or people in the
   * replied thread (protects against instructions hidden in emails). The
   * owner's own edits are not restricted.
   */
  restrictRecipients?: boolean;
}

/** Create a proposal (and its Gmail draft). Returns null if the autopilot already has one open for the contact. */
export async function proposeEmail(input: ProposeInput): Promise<EmailDraft | null> {
  const contactId = input.contactId ?? null;
  const replyToMessageId = input.replyToMessageId ?? null;
  let to = cleanList(input.to);
  const cc = cleanList(input.cc);
  if (!to.length && contactId) {
    const contact = await getContact(contactId);
    if (contact?.primaryEmail) to = [contact.primaryEmail];
  }
  if (!to.length) throw new DraftError("The email needs at least one recipient.");
  const invalid = [...to, ...cc].find((e) => !isValidEmail(e));
  if (invalid) throw new DraftError(`Invalid address: ${invalid}`);

  if (input.restrictRecipients ?? input.origin !== "owner") {
    const allowed = await allowedRecipients(contactId, replyToMessageId);
    const outside = [...to, ...cc].filter((e) => !allowed.has(e));
    if (outside.length) {
      throw new DraftError(`Claude can only address this contact or people already in the thread (not ${outside.join(", ")}).`);
    }
  }

  const accountId = input.accountId ?? (await pickAccount(contactId, replyToMessageId));

  // The Gmail draft is a convenience (visible in Gmail too); the proposal is kept even if it fails.
  let gmailDraftId: string | null = null;
  let error: string | null = null;
  try {
    const saved = await saveGmailDraft({ accountId, to, cc, subject: input.subject, body: input.body, replyToMessageId });
    gmailDraftId = saved.draftId;
  } catch (e) {
    error = `Not saved to Gmail yet: ${errorMessage(e)}`;
  }

  const id = await insertDraft({
    accountId,
    contactId,
    opportunityId: input.opportunityId ?? null,
    replyToMessageId,
    purpose: input.purpose ?? "follow_up",
    origin: input.origin,
    to,
    cc,
    subject: input.subject,
    body: input.body,
    rationale: input.rationale ?? null,
    gmailDraftId,
  });
  if (!id) {
    if (gmailDraftId) await deleteGmailDraft(accountId, gmailDraftId);
    return null;
  }
  if (error) await updateDraft(id, { error });
  return getDraft(id);
}

/** Claude writes an email for a contact from their history and puts it in the queue. */
export async function proposeFollowUp(
  contactId: string,
  options: { instructions?: string; purpose?: DraftPurpose; origin?: DraftOrigin } = {},
): Promise<EmailDraft | null> {
  const draft = await draftFollowUp(contactId, { instructions: options.instructions, purpose: options.purpose });
  return proposeEmail({
    contactId,
    accountId: draft.accountId,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    replyToMessageId: draft.replyToMessageId,
    purpose: draft.purpose,
    origin: options.origin ?? "owner",
    rationale: draft.rationale,
    restrictRecipients: true,
  });
}

/** Owner edits (subject/body/recipients) → saved and mirrored to the Gmail draft. */
export async function saveDraftEdits(id: string, edits: { subject: string; body: string; to: string[]; cc: string[] }): Promise<EmailDraft> {
  const draft = await getDraft(id);
  if (!draft) throw new DraftError("Draft not found.");
  if (!["proposed", "failed"].includes(draft.status)) throw new DraftError("This email can no longer be edited.");
  const to = cleanList(edits.to);
  const cc = cleanList(edits.cc);
  if (!to.length) throw new DraftError("The email needs at least one recipient.");
  const invalid = [...to, ...cc].find((e) => !isValidEmail(e));
  if (invalid) throw new DraftError(`Invalid address: ${invalid}`);
  await updateDraft(id, { subject: edits.subject, body: edits.body, to, cc });
  await syncGmailDraft(id);
  return (await getDraft(id))!;
}

/** "Change this…": Claude rewrites the proposal following the owner's note. */
export async function reviseDraft(id: string, note: string): Promise<EmailDraft> {
  const draft = await getDraft(id);
  if (!draft) throw new DraftError("Draft not found.");
  if (!note.trim()) throw new DraftError("Write what should change.");
  if (!(await transitionDraft(id, ["proposed", "failed"], "revising"))) throw new DraftError("This email is being processed already.");
  try {
    const revised = await reviseEmail({ subject: draft.subject, body: draft.body, note, contactId: draft.contact?.id ?? null });
    await pushRevision(id, note.trim());
    await updateDraft(id, { subject: revised.subject, body: revised.body, status: "proposed", error: null });
    await syncGmailDraft(id);
  } catch (e) {
    await updateDraft(id, { status: "proposed", error: `Revision failed: ${errorMessage(e)}` });
    throw e;
  }
  return (await getDraft(id))!;
}

/** Create or update the Gmail draft so it matches the row. Records (does not throw) Gmail errors. */
async function syncGmailDraft(id: string): Promise<void> {
  const draft = await getDraft(id);
  if (!draft) return;
  try {
    const params = {
      accountId: draft.accountId,
      to: draft.to,
      cc: draft.cc,
      subject: draft.subject,
      body: draft.body,
      replyToMessageId: draft.replyToMessageId,
    };
    const saved = draft.gmailDraftId
      ? await updateGmailDraft({ ...params, draftId: draft.gmailDraftId }).catch(() => saveGmailDraft(params))
      : await saveGmailDraft(params);
    await updateDraft(id, { gmailDraftId: saved.draftId, error: null });
  } catch (e) {
    await updateDraft(id, { error: `Not saved to Gmail yet: ${errorMessage(e)}` });
  }
}

/** Approve → send through Gmail. Safe against double taps (status transition). */
export async function approveAndSend(id: string): Promise<EmailDraft> {
  if (!(await transitionDraft(id, ["proposed", "failed"], "sending"))) {
    throw new DraftError("This email was already sent or is being sent.");
  }
  try {
    let draft = (await getDraft(id))!;
    if (!draft.gmailDraftId || draft.error) {
      await syncGmailDraft(id);
      draft = (await getDraft(id))!;
      if (!draft.gmailDraftId) throw new DraftError(draft.error ?? "Could not create the Gmail draft.");
    }
    const sent = await sendGmailDraft(draft.accountId, draft.gmailDraftId);
    await updateDraft(id, {
      status: "sent",
      sentAt: new Date(),
      sentGmailMessageId: sent.gmailMessageId,
      gmailThreadId: sent.gmailThreadId,
      error: null,
    });
    // Sending answers the conversation: clear a follow-up that is due today or earlier.
    if (draft.contact) {
      await sql`
        update contacts set follow_up_at = null, follow_up_note = null
         where id = ${draft.contact.id} and follow_up_at <= current_date`;
    }
  } catch (e) {
    await updateDraft(id, { status: "failed", error: `Not sent: ${errorMessage(e)}` });
    throw e;
  }
  return (await getDraft(id))!;
}

export async function discardDraft(id: string): Promise<void> {
  const draft = await getDraft(id);
  if (!draft) return;
  if (!(await transitionDraft(id, ["proposed", "failed"], "discarded"))) throw new DraftError("This email can no longer be discarded.");
  if (draft.gmailDraftId) await deleteGmailDraft(draft.accountId, draft.gmailDraftId);
}
