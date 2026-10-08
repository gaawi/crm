"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import type { ActionOutcome } from "@/lib/booking/types";
import {
  CampaignError,
  cancelCampaign,
  discardCampaign,
  getCampaignSummary,
  pauseCampaign,
  requeueHeldDraft,
  resumeCampaign,
  startCampaign,
  updateCampaignSettings,
} from "@/lib/campaigns/campaigns";
import type { CampaignSettings, CampaignSummary } from "@/lib/campaigns/types";
import { listDrafts } from "@/lib/queries/drafts";
import type { EmailDraft } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { idSchema } from "../_lib/validation";

/**
 * Campaigns in Approvals. startCampaignAction is the owner's approval of a
 * campaign ("Approve N and start sending"): only then are its emails queued,
 * and the cron sends them gradually. Every action returns the campaign as it
 * is afterwards (counts, estimates). The emails themselves use the existing
 * draft actions in lib/ai/actions.ts (edit, discard, approve = send now).
 */

const settingsSchema = z
  .object({
    perHour: z.number().int(),
    dailyCap: z.number().int(),
    windowStart: z.number().int(),
    windowEnd: z.number().int(),
    weekdaysOnly: z.boolean(),
    timezone: z.string().trim().max(64),
  })
  .partial();

type CampaignOutcome = ActionOutcome<{ campaign: CampaignSummary }>;

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof CampaignError) return { ok: false, error: error.message };
  console.error("Campaign action failed:", error);
  return { ok: false, error: errorMessage(error) };
}

async function withCampaign(campaignId: string, run: (id: string) => Promise<unknown>): Promise<CampaignOutcome> {
  await requireSession();
  const id = idSchema.safeParse(campaignId);
  if (!id.success) return { ok: false, error: "Campaign not found." };
  try {
    await run(id.data);
    refresh();
    const campaign = await getCampaignSummary(id.data);
    return campaign ? { ok: true, campaign } : { ok: false, error: "Campaign not found." };
  } catch (error) {
    refresh();
    return failure(error);
  }
}

/** A campaign with its numbers and estimates (for a dialog that opens on demand). */
export async function campaignAction(campaignId: string): Promise<CampaignOutcome> {
  return withCampaign(campaignId, async () => {});
}

/** The campaign's emails, in the order they are sent (every status). */
export async function campaignDraftsAction(campaignId: string): Promise<ActionOutcome<{ drafts: EmailDraft[] }>> {
  await requireSession();
  const id = idSchema.safeParse(campaignId);
  if (!id.success) return { ok: false, error: "Campaign not found." };
  return { ok: true, drafts: await listDrafts({ campaign: id.data }) };
}

/**
 * THE APPROVAL: "Approve N and start sending" with these settings (missing
 * ones keep the campaign's). Its waiting emails (proposed, failed) become
 * queued and the campaign runs.
 */
export async function startCampaignAction(campaignId: string, settings: Partial<CampaignSettings> = {}): Promise<CampaignOutcome> {
  const parsed = settingsSchema.safeParse(settings ?? {});
  if (!parsed.success) return { ok: false, error: "Check the sending settings." };
  return withCampaign(campaignId, (id) => startCampaign(id, parsed.data));
}

/** Change the sending settings (or the name) of a campaign; queued emails stay queued. */
export async function updateCampaignSettingsAction(
  campaignId: string,
  settings: Partial<CampaignSettings> & { name?: string },
): Promise<CampaignOutcome> {
  const parsed = settingsSchema.extend({ name: z.string().max(200).optional() }).safeParse(settings ?? {});
  if (!parsed.success) return { ok: false, error: "Check the sending settings." };
  return withCampaign(campaignId, (id) => updateCampaignSettings(id, parsed.data));
}

export async function pauseCampaignAction(campaignId: string): Promise<CampaignOutcome> {
  return withCampaign(campaignId, pauseCampaign);
}

export async function resumeCampaignAction(campaignId: string): Promise<CampaignOutcome> {
  return withCampaign(campaignId, resumeCampaign);
}

/** Stop the campaign: queued emails go back to waiting for approval. */
export async function cancelCampaignAction(campaignId: string): Promise<CampaignOutcome> {
  return withCampaign(campaignId, cancelCampaign);
}

/** Discard every unsent email of the campaign (and their Gmail drafts) and cancel it. */
export async function discardCampaignAction(campaignId: string): Promise<ActionOutcome<{ discarded: number }>> {
  await requireSession();
  const id = idSchema.safeParse(campaignId);
  if (!id.success) return { ok: false, error: "Campaign not found." };
  try {
    const discarded = await discardCampaign(id.data);
    refresh();
    return { ok: true, discarded };
  } catch (error) {
    return failure(error);
  }
}

/**
 * "Queue again" on a held-back campaign email, once the owner has checked the
 * conversation: queued again when its campaign is sending or paused (else it
 * waits for the campaign's approval); the reply check starts from now.
 */
export async function requeueHeldDraftAction(draftId: string): Promise<ActionOutcome<{ queued: boolean }>> {
  await requireSession();
  const id = idSchema.safeParse(draftId);
  if (!id.success) return { ok: false, error: "Email not found." };
  try {
    const result = await requeueHeldDraft(id.data);
    refresh();
    return { ok: true, queued: result.queued };
  } catch (error) {
    return failure(error);
  }
}
