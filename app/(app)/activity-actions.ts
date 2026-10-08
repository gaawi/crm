"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import type { ActionOutcome, ActivityInput, ActivityView, Timeline } from "@/lib/booking/types";
import { zonedDateTimeToUtc } from "@/lib/dates";
import { env } from "@/lib/env";
import { addActivity, deleteActivity, timelineForContact } from "@/lib/queries/activities";
import type { CallOutcome, OpportunityStage } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { idSchema, longText, nextActionSchema, optionalDateSchema, shortText } from "./_lib/validation";

/**
 * Calls, WhatsApp, meetings, hand-logged emails and notes, from anywhere: a
 * booking row (opportunityId), a contact page or Today (contactId), an
 * organization (organizationId).
 */

const outcomeSchema = z.enum(["reached", "no_answer", "voicemail", "call_back", "wrong_number"] satisfies CallOutcome[]);
const optionalId = z.union([z.literal(""), idSchema, z.null()]).optional().transform((v) => v || null);

const activitySchema = z
  .object({
    kind: z.enum(["call", "whatsapp", "meeting", "email", "note"]),
    outcome: outcomeSchema.nullable().optional(),
    body: longText.nullable().optional(),
    occurredAt: z.string().trim().max(40).nullable().optional(),
    opportunityId: optionalId,
    contactId: optionalId,
    organizationId: optionalId,
    followUpAt: z.union([optionalDateSchema, z.null()]).optional(),
    nextStep: shortText.nullable().optional(),
    nextAction: nextActionSchema.nullable().optional(),
  })
  .refine((a) => a.opportunityId || a.contactId || a.organizationId, "Log this on a contact, an organization or a row.");

type Logged = ActionOutcome<{ activity: ActivityView; stageChanged: OpportunityStage | null }>;

async function log(input: ActivityInput): Promise<Logged> {
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  const a = parsed.data;
  let occurredAt: Date | null = null;
  if (a.occurredAt) {
    occurredAt = zonedDateTimeToUtc(a.occurredAt, env.timezone);
    if (!occurredAt || occurredAt.getUTCFullYear() < 2000 || occurredAt.getTime() > Date.now() + 366 * 86_400_000) {
      return { ok: false, error: "Use a valid date and time." };
    }
  }
  try {
    const added = await addActivity({
      kind: a.kind,
      outcome: a.kind === "call" ? (a.outcome ?? null) : null,
      body: a.body ?? null,
      occurredAt,
      opportunityId: a.opportunityId,
      contactId: a.contactId,
      organizationId: a.organizationId,
      followUpAt: a.followUpAt ?? null,
      nextStep: a.nextStep ?? null,
      ...(a.nextAction !== undefined ? { nextAction: a.nextAction } : {}),
    });
    refresh();
    return { ok: true, ...added };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Log a call / WhatsApp / meeting / email / note, optionally with a follow-up
 * and the row's next step (`nextAction`: omit to keep it, null to clear it).
 * On a "To contact" row, anything but a note moves it to "Contacted".
 */
export async function addActivityAction(input: ActivityInput): Promise<Logged> {
  await requireSession();
  return log(input);
}

/** addActivityAction for a call (the log-call dialog after tapping Call). */
export async function logCallAction(input: Omit<ActivityInput, "kind"> & { outcome: CallOutcome | null }): Promise<Logged> {
  await requireSession();
  return log({ ...input, kind: "call" });
}

/** Delete one activity (automatic status entries too). */
export async function deleteActivityAction(activityId: string): Promise<ActionOutcome> {
  await requireSession();
  const id = idSchema.safeParse(activityId);
  if (!id.success) return { ok: false, error: "Not found" };
  const deleted = await deleteActivity(id.data);
  if (!deleted) return { ok: false, error: "Already deleted" };
  refresh();
  return { ok: true };
}

/** A contact's activities and emails, newest first (for a client-side timeline). */
export async function contactTimelineAction(contactId: string): Promise<ActionOutcome<{ timeline: Timeline }>> {
  await requireSession();
  const id = idSchema.safeParse(contactId);
  if (!id.success) return { ok: false, error: "Contact not found" };
  const timeline = await timelineForContact(id.data);
  return timeline ? { ok: true, timeline } : { ok: false, error: "Contact not found" };
}
