import "server-only";
import { noEmDash } from "@/lib/text/no-em-dash";
import { sql } from "@/lib/db";
import { addDays, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { DraftError, saveDraftEdits } from "@/lib/ai/approvals";
import { DEFAULT_POSTPONE_DAYS } from "@/lib/assistant/types";
import { syncDraftAction } from "@/lib/queries/assistant";
import { getDraft, pushRevision } from "@/lib/queries/drafts";
import type { EmailDraft } from "@/lib/types";

/**
 * What the owner (and the routine, for revisions) does with an assistant
 * email besides Approve / Discard (lib/ai/approvals.ts). None of these send.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Request changes": the routine writes a new version on its next run. */
export async function requestDraftChanges(id: string, comment: string): Promise<void> {
  const note = comment.trim().slice(0, 2000);
  if (!note) throw new DraftError("Write what should change.");
  const draft = await getDraft(id);
  if (!draft) throw new DraftError("Draft not found.");
  await pushRevision(id, note);
  const result = await sql`
    update email_drafts set status = 'changes_requested', revision_request = ${note}, postponed_until = null
     where id = ${id} and status in ('proposed', 'failed', 'postponed')`;
  if (!result.count) throw new DraftError("This email can no longer be changed.");
  await syncDraftAction(id, "open");
}

/**
 * "Postpone": hidden until `until` (default a week from today), then back to
 * waiting for approval (releasePostponed).
 */
export async function postponeDraft(id: string, until?: string | null): Promise<string> {
  const today = todayIn(env.timezone);
  const date = until && DATE.test(until) ? until : addDays(today, DEFAULT_POSTPONE_DAYS);
  if (date <= today) throw new DraftError("Pick a day after today.");
  const result = await sql`
    update email_drafts set status = 'postponed', postponed_until = ${date}::date
     where id = ${id} and status in ('proposed', 'failed', 'changes_requested')`;
  if (!result.count) throw new DraftError("This email can no longer be postponed.");
  await syncDraftAction(id, "postponed", date);
  return date;
}

/**
 * The routine's new version of an email the owner asked to change: saved
 * (and mirrored to the Gmail draft) and back to waiting for approval.
 */
export async function applyDraftRevision(id: string, edits: { subject: string; body: string }): Promise<EmailDraft> {
  const moved = await sql`
    update email_drafts set status = 'proposed', revision_request = null, error = null
     where id = ${id} and status = 'changes_requested'`;
  if (!moved.count) throw new DraftError("This email is not waiting for a new version.");
  const draft = (await getDraft(id))!;
  try {
    return await saveDraftEdits(id, { subject: noEmDash(edits.subject), body: noEmDash(edits.body), to: draft.to, cc: draft.cc });
  } catch (e) {
    // Keep the owner's request so the next run tries again.
    await sql`
      update email_drafts set status = 'changes_requested', revision_request = ${draft.revisions.at(-1)?.note ?? "New version"}
       where id = ${id} and status = 'proposed'`;
    throw e;
  }
}
