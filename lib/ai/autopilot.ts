import "server-only";
import { sql } from "@/lib/db";
import { proposeFollowUp } from "@/lib/ai/approvals";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { getFollowUps } from "@/lib/queries/followups";
import { getSettings, saveSettings } from "@/lib/queries/settings";
import type { DraftPurpose } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

export interface AutopilotResult {
  ran: boolean;
  proposed: number;
  skipped: number;
  errors: string[];
}

/**
 * Autopilot: when enabled in Settings, look at the follow-up lists (people
 * waiting for my reply, follow-ups due, emails with no answer) and propose
 * emails into the approval queue (email_drafts + Gmail drafts). Never sends.
 * Runs at most once per `minIntervalHours` (default 20) unless `force`.
 */
export async function runAutopilotIfDue(options: {
  deadline: number;
  force?: boolean;
  minIntervalHours?: number;
}): Promise<AutopilotResult> {
  const result: AutopilotResult = { ran: false, proposed: 0, skipped: 0, errors: [] };
  if (!env.claudeEnabled) return result; // Claude inside the CRM is off (no ANTHROPIC_API_KEY).
  const settings = await getSettings("autopilot");
  if (!options.force && !settings.enabled) return result;
  const minInterval = (options.minIntervalHours ?? 20) * 3_600_000;
  if (!options.force && settings.lastRunAt && Date.now() - new Date(settings.lastRunAt).getTime() < minInterval) return result;

  const [{ active }] = await sql<{ active: number }[]>`select count(*)::int as active from gmail_accounts where status = 'active'`;
  if (!active) return result;

  result.ran = true;
  await saveSettings("autopilot", { lastRunAt: new Date().toISOString() });

  const lists = await getFollowUps({ today: todayIn(env.timezone), awaitingDays: settings.awaitingDays, limit: 50 });
  const candidates: { contactId: string; purpose: DraftPurpose }[] = [];
  const seen = new Set<string>();
  const add = (contactId: string, purpose: DraftPurpose) => {
    if (!seen.has(contactId)) {
      seen.add(contactId);
      candidates.push({ contactId, purpose });
    }
  };
  if (settings.needsReply) lists.needsReply.forEach((c) => add(c.id, "reply"));
  if (settings.followUpsDue) lists.due.forEach((c) => add(c.id, "follow_up"));
  if (settings.awaitingReply) lists.awaitingReply.forEach((c) => add(c.id, "nudge"));

  // Skip people who already have an open proposal or had one handled in the last week.
  const busy = new Set(
    (
      await sql<{ contactId: string }[]>`
        select distinct contact_id from email_drafts
         where contact_id is not null
           and (status in ('proposed', 'revising', 'sending', 'failed') or updated_at > now() - interval '7 days')`
    ).map((r) => r.contactId),
  );

  for (const candidate of candidates) {
    if (result.proposed >= settings.maxPerRun) break;
    if (Date.now() > options.deadline - 30_000) break;
    if (busy.has(candidate.contactId)) {
      result.skipped++;
      continue;
    }
    try {
      const draft = await proposeFollowUp(candidate.contactId, { purpose: candidate.purpose, origin: "autopilot" });
      if (draft) result.proposed++;
      else result.skipped++;
    } catch (error) {
      result.errors.push(errorMessage(error));
    }
  }
  return result;
}
