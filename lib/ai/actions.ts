"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { approveAndSend, discardDraft, DraftError, proposeFollowUp, reviseDraft, saveDraftEdits } from "@/lib/ai/approvals";
import { draftErrorMessage } from "@/lib/ai/draft";
import { getCrmTools, runCrmTool } from "@/lib/ai/tools";
import { runAutopilotIfDue } from "@/lib/ai/autopilot";
import { DraftError as GmailDraftError } from "@/lib/sync/drafts";
import { splitList } from "@/lib/utils";

/** Server actions behind the chat confirmation cards, the Approvals page and "Draft with Claude". */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

function failure(error: unknown): ActionResult {
  if (error instanceof DraftError || error instanceof GmailDraftError) return { ok: false, error: error.message };
  return { ok: false, error: draftErrorMessage(error) };
}

/** Apply a change Claude proposed in the chat (only tools marked `confirm`). */
export async function confirmAssistantAction(name: string, input: unknown): Promise<ActionResult> {
  await requireSession();
  const tool = getCrmTools().find((t) => t.name === name);
  if (!tool?.confirm) return { ok: false, error: "This action cannot be confirmed here." };
  const outcome = await runCrmTool(name, input, { today: todayIn(env.timezone), timezone: env.timezone });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return { ok: true, message: "Done" };
}

/** Contact page → "Draft with Claude": prepares an email in the approval queue. */
export async function draftWithClaude(contactId: string, instructions: string): Promise<ActionResult & { draftId?: string }> {
  await requireSession();
  if (!uuid.safeParse(contactId).success) return { ok: false, error: "Invalid contact" };
  try {
    const draft = await proposeFollowUp(contactId, { instructions: instructions.slice(0, 2000), origin: "owner" });
    if (!draft) return { ok: false, error: "There is already an open draft for this contact in Approvals." };
    refresh();
    return { ok: true, draftId: draft.id };
  } catch (error) {
    return failure(error);
  }
}

export async function approveDraftAction(id: string): Promise<ActionResult> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  try {
    const draft = await approveAndSend(id);
    refresh();
    return { ok: true, message: `Sent to ${draft.to.join(", ")}` };
  } catch (error) {
    refresh();
    return failure(error);
  }
}

export async function reviseDraftAction(id: string, note: string): Promise<ActionResult> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  try {
    await reviseDraft(id, note.slice(0, 2000));
    refresh();
    return { ok: true, message: "Updated" };
  } catch (error) {
    refresh();
    return failure(error);
  }
}

export async function saveDraftEditsAction(id: string, formData: FormData): Promise<ActionResult> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  try {
    await saveDraftEdits(id, {
      subject: String(formData.get("subject") ?? "").slice(0, 300),
      body: String(formData.get("body") ?? "").slice(0, 20000),
      to: splitList(String(formData.get("to") ?? "").replace(/;/g, ",")),
      cc: splitList(String(formData.get("cc") ?? "").replace(/;/g, ",")),
    });
    refresh();
    return { ok: true, message: "Saved" };
  } catch (error) {
    return failure(error);
  }
}

export async function discardDraftAction(id: string): Promise<ActionResult> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  try {
    await discardDraft(id);
    refresh();
    return { ok: true, message: "Discarded" };
  } catch (error) {
    return failure(error);
  }
}

/** Approvals → "Prepare drafts now": run the autopilot once, right away. */
export async function prepareDraftsNow(): Promise<ActionResult> {
  await requireSession();
  try {
    const result = await runAutopilotIfDue({ deadline: Date.now() + 240_000, force: true });
    refresh();
    if (result.errors.length && !result.proposed) return { ok: false, error: result.errors[0] };
    return {
      ok: true,
      message: result.proposed
        ? `Prepared ${result.proposed} email${result.proposed === 1 ? "" : "s"} for your approval`
        : "Nothing to prepare right now",
    };
  } catch (error) {
    return failure(error);
  }
}
