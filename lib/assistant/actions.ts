"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { approveAndSend, discardDraft, DraftError, saveDraftEdits } from "@/lib/ai/approvals";
import { draftErrorMessage } from "@/lib/ai/draft";
import { DEFAULT_POSTPONE_DAYS, MAX_ACTION_COMMENT } from "@/lib/assistant/types";
import { addDays, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { getDraft } from "@/lib/queries/drafts";
import { postponeDraft, requestDraftChanges } from "@/lib/assistant/drafts";
import { addActionComment, setActionStatus, syncDraftAction, updateAssistantSettings } from "@/lib/queries/assistant";
import { DraftError as GmailDraftError } from "@/lib/sync/drafts";

/**
 * The owner's side of the daily campaign assistant: approve / change /
 * postpone / discard its emails, complete / postpone / dismiss its actions,
 * pause it and edit its brief. Only "Approve & send" sends anything.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };

const uuid = z.guid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function failure(error: unknown): Result {
  if (error instanceof DraftError || error instanceof GmailDraftError) return { ok: false, error: error.message };
  return { ok: false, error: draftErrorMessage(error) };
}

/** Approve & send: the existing path (a gradual-campaign email keeps its campaign rules: approveAndSend sends a queued one now only on the owner's tap). */
export async function approveAssistantDraftAction(id: string): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  try {
    const draft = await approveAndSend(id);
    await syncDraftAction(id, "done");
    refresh();
    return { ok: true, message: `Sent to ${draft.to.join(", ")}` };
  } catch (error) {
    refresh();
    return failure(error);
  }
}

/** Inline edit of subject / body before approving. */
export async function editAssistantDraftAction(id: string, subject: string, body: string): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  try {
    const draft = await getDraft(id);
    if (!draft) return { ok: false, error: "Draft not found." };
    await saveDraftEdits(id, { subject: String(subject).slice(0, 300), body: String(body).slice(0, 20_000), to: draft.to, cc: draft.cc });
    refresh();
    return { ok: true, message: "Saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Request changes: the assistant writes a new version on its next run. */
export async function requestAssistantChangesAction(id: string, comment: string): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  try {
    await requestDraftChanges(id, String(comment ?? ""));
    refresh();
    return { ok: true, message: "The assistant will write a new version on its next review." };
  } catch (error) {
    return failure(error);
  }
}

/** Postpone until a day (default a week): it comes back by itself that day. */
export async function postponeAssistantDraftAction(id: string, until?: string | null): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  if (until && !date.safeParse(until).success) return { ok: false, error: "Pick a valid date." };
  try {
    const day = await postponeDraft(id, until || null);
    refresh();
    return { ok: true, message: `Postponed until ${day}` };
  } catch (error) {
    return failure(error);
  }
}

export async function discardAssistantDraftAction(id: string): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid draft" };
  try {
    await discardDraft(id);
    await syncDraftAction(id, "dismissed");
    refresh();
    return { ok: true, message: "Discarded" };
  } catch (error) {
    return failure(error);
  }
}

/** Recommended action: done / postponed (until a day, default a week) / dismissed / open again. */
export async function setAssistantActionStatusAction(
  id: string,
  status: "open" | "done" | "postponed" | "dismissed",
  until?: string | null,
): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(id).success || !["open", "done", "postponed", "dismissed"].includes(status)) return { ok: false, error: "Invalid action" };
  if (until && !date.safeParse(until).success) return { ok: false, error: "Pick a valid date." };
  let day: string | null = null;
  if (status === "postponed") {
    const today = todayIn(env.timezone);
    day = until || addDays(today, DEFAULT_POSTPONE_DAYS);
    if (day <= today) return { ok: false, error: "Pick a day after today." };
  }
  if (!(await setActionStatus(id, status, day))) return { ok: false, error: "Action not found." };
  refresh();
  return { ok: true };
}

/** A comment on a suggested action: the assistant answers it, and updates or closes the action, on its next run. */
export async function commentAssistantActionAction(id: string, comment: string): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid action" };
  const text = String(comment ?? "").trim();
  if (!text) return { ok: false, error: "Write a comment." };
  if (text.length > MAX_ACTION_COMMENT) return { ok: false, error: `Keep it under ${MAX_ACTION_COMMENT} characters.` };
  if (!(await addActionComment(id, text))) return { ok: false, error: "Action not found." };
  refresh();
  return { ok: true, message: "The assistant will answer on its next review." };
}

/** Active / Paused switch of a campaign's assistant. */
export async function setAssistantActiveAction(projectId: string, active: boolean): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Campaign not found." };
  try {
    await updateAssistantSettings(projectId, { active: Boolean(active) });
    refresh();
    return { ok: true, message: active ? "Assistant active" : "Assistant paused" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save." };
  }
}

/** "What should the assistant aim for in this campaign?" */
export async function saveAssistantBriefAction(projectId: string, brief: string): Promise<Result> {
  await requireSession();
  if (!uuid.safeParse(projectId).success) return { ok: false, error: "Campaign not found." };
  try {
    await updateAssistantSettings(projectId, { brief: String(brief ?? "").slice(0, 5000) });
    refresh();
    return { ok: true, message: "Saved" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save." };
  }
}
