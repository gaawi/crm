"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { addDays, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { dismissReply, updateContact } from "@/lib/queries/contacts";
import { updateOpportunity } from "@/lib/queries/opportunities";
import { PERSONA_COOKIE } from "@/lib/persona";

/** Follow-up done: clear the date and note. */
export async function completeFollowUp(contactId: string): Promise<void> {
  await requireSession();
  await updateContact(contactId, { followUpAt: null, followUpNote: null });
  refresh();
}

/** Push a follow-up out by `days` from today. */
export async function snoozeFollowUp(contactId: string, days: number): Promise<void> {
  await requireSession();
  await updateContact(contactId, { followUpAt: addDays(todayIn(env.timezone), Math.max(1, Math.min(days, 365))) });
  refresh();
}

/** Hide from "needs reply" / "waiting on them" until newer mail arrives. */
export async function markReplyDone(contactId: string): Promise<void> {
  await requireSession();
  await dismissReply(contactId);
  refresh();
}

/** Today's "Done" on a goal: its next step is done (date, next action and detail cleared). */
export async function completeOpportunityFollowUp(opportunityId: string): Promise<void> {
  await requireSession();
  await updateOpportunity(opportunityId, { followUpAt: null, nextAction: null, nextStep: null });
  refresh();
}

/** "I am Guillermo / Josefina" on Today: remembered on this browser for a year. */
export async function setPersona(persona: string): Promise<void> {
  await requireSession();
  const value = persona === "josefina" ? "josefina" : "guillermo";
  (await cookies()).set(PERSONA_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  refresh();
}
