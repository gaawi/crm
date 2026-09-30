"use server";

import { refresh } from "next/cache";
import { requireSession } from "@/lib/auth";
import { addDays, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { dismissReply, updateContact } from "@/lib/queries/contacts";
import { updateOpportunity } from "@/lib/queries/opportunities";

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

export async function completeOpportunityFollowUp(opportunityId: string): Promise<void> {
  await requireSession();
  await updateOpportunity(opportunityId, { followUpAt: null });
  refresh();
}
