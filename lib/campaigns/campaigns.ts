import "server-only";
import { sql, type Tx } from "@/lib/db";
import { estimateSends, startOfZonedDay, validateCampaignSettings, zonedParts } from "@/lib/campaigns/schedule";
import {
  ACCOUNT_DAILY_SEND_CAP,
  DEFAULT_CAMPAIGN_SETTINGS,
  HELD_BACK_PREFIX,
  type Campaign,
  type CampaignCounts,
  type CampaignSettings,
  type CampaignSummary,
} from "@/lib/campaigns/types";
import { deleteGmailDraft } from "@/lib/sync/drafts";
import type { CampaignStatus, DraftStatus } from "@/lib/types";

/**
 * Email campaigns: emails prepared together and sent gradually once the
 * owner approves them. startCampaign IS the owner's approval: it is the only
 * place drafts become "queued", and the scheduler only ever sends queued
 * drafts of running campaigns (lib/campaigns/scheduler.ts).
 */

export class CampaignError extends Error {}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES: DraftStatus[] = ["proposed", "queued", "revising", "sending", "sent", "discarded", "failed", "postponed", "changes_requested"];

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

interface CampaignRow extends Omit<Campaign, "counts" | "lastSentAt" | "startedAt" | "finishedAt" | "createdAt" | "updatedAt"> {
  lastSentAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  counts: Partial<Record<DraftStatus, number>> | null;
}

const campaignColumns = () => sql`
  c.id, c.name, c.project_id, p.name as project_name, c.account_id, a.email as account_email, a.status as account_status,
  c.status, c.per_hour, c.daily_cap, c.window_start, c.window_end, c.weekdays_only, c.timezone,
  c.last_sent_at, c.consecutive_failures, c.error, c.started_at, c.finished_at, c.created_at, c.updated_at,
  (select count(*)::int from email_drafts d
    where d.campaign_id = c.id and d.status = 'proposed' and starts_with(coalesce(d.error, ''), ${HELD_BACK_PREFIX})) as held_back,
  (select json_object_agg(s.status, s.n) from (
     select d.status, count(*)::int as n from email_drafts d where d.campaign_id = c.id group by d.status
   ) s) as counts
`;

const campaignJoins = () => sql`
  join gmail_accounts a on a.id = c.account_id
  left join projects p on p.id = c.project_id
`;

function toCampaign(row: CampaignRow): Campaign {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, row.counts?.[s] ?? 0])) as CampaignCounts;
  counts.total = STATUSES.reduce((sum, s) => sum + counts[s], 0);
  return {
    ...row,
    windowStart: Number(row.windowStart),
    windowEnd: Number(row.windowEnd),
    lastSentAt: iso(row.lastSentAt),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    counts,
  };
}

export function settingsOf(c: CampaignSettings): CampaignSettings {
  return {
    perHour: c.perHour,
    dailyCap: c.dailyCap,
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
    weekdaysOnly: c.weekdaysOnly,
    timezone: c.timezone,
  };
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  if (!ID.test(id)) return null;
  const [row] = await sql<CampaignRow[]>`select ${campaignColumns()} from email_campaigns c ${campaignJoins()} where c.id = ${id}`;
  return row ? toCampaign(row) : null;
}

/**
 * Campaigns, waiting for approval first, then newest first. Default: the
 * ones Approvals shows — sending or paused, plus any (waiting for approval,
 * done, cancelled) that still has emails waiting for the owner (to approve,
 * held back, failed, or returned by a cancel). `statuses` lists exactly those
 * statuses instead; `projectId` filters by sheet.
 */
export async function listCampaigns(options: { statuses?: CampaignStatus[]; projectId?: string; limit?: number } = {}): Promise<Campaign[]> {
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 200);
  const rows = await sql<CampaignRow[]>`
    select ${campaignColumns()}
      from email_campaigns c
      ${campaignJoins()}
     where ${
       options.statuses
         ? sql`c.status = any(${options.statuses}::text[])`
         : sql`(c.status in ('running', 'paused')
                or exists (select 1 from email_drafts d where d.campaign_id = c.id and d.status in ('proposed', 'queued', 'failed')))`
     }
       ${options.projectId && ID.test(options.projectId) ? sql`and c.project_id = ${options.projectId}` : sql``}
     order by (c.status = 'draft') desc, c.created_at desc
     limit ${limit}
  `;
  return rows.map(toCampaign);
}

/** Sent by this campaign today in its timezone (sent_at in [start of today, now]). */
export async function sentToday(db: Tx | typeof sql, campaign: { id: string; timezone: string }, now: Date): Promise<number> {
  const start = startOfZonedDay(zonedParts(now, campaign.timezone).date, campaign.timezone);
  const [row] = await db<{ n: number }[]>`
    select count(*)::int as n from email_drafts
     where campaign_id = ${campaign.id} and status = 'sent' and sent_at >= ${start} and sent_at <= ${now}`;
  return row.n;
}

/** Sent by every campaign of the account in the 24 hours before `now`. */
export async function accountSentLast24h(db: Tx | typeof sql, accountId: string, now: Date): Promise<number> {
  const [row] = await db<{ n: number }[]>`
    select count(*)::int as n from email_drafts
     where account_id = ${accountId} and campaign_id is not null and status = 'sent'
       and sent_at > ${new Date(now.getTime() - 86_400_000)} and sent_at <= ${now}`;
  return row.n;
}

/** The campaign with today's numbers and estimates of the next and the last send. */
export async function getCampaignSummary(id: string, now: Date = new Date()): Promise<CampaignSummary | null> {
  const campaign = await getCampaign(id);
  return campaign ? summarize(campaign, now) : null;
}

export async function summarize(campaign: Campaign, now: Date = new Date()): Promise<CampaignSummary> {
  const [today, account] = await Promise.all([sentToday(sql, campaign, now), accountSentLast24h(sql, campaign.accountId, now)]);
  const remaining =
    campaign.status === "draft" || campaign.status === "cancelled" || campaign.status === "done"
      ? Math.max(0, campaign.counts.proposed + campaign.counts.failed - campaign.heldBack)
      : campaign.counts.queued;
  const estimate = estimateSends(settingsOf(campaign), {
    count: remaining,
    now,
    lastSentAt: campaign.lastSentAt ? new Date(campaign.lastSentAt) : null,
    sentToday: today,
  });
  return {
    ...campaign,
    sentToday: today,
    accountSentLast24h: account,
    remaining,
    nextSendAt: campaign.status === "running" && remaining ? iso(estimate.next) : null,
    finishEstimate: iso(estimate.finish),
  };
}

export async function listCampaignSummaries(options: Parameters<typeof listCampaigns>[0] = {}, now: Date = new Date()): Promise<CampaignSummary[]> {
  return Promise.all((await listCampaigns(options)).map((c) => summarize(c, now)));
}

/**
 * A new campaign (status draft) for drafts prepared together; links them.
 * Returns its id. Used by prepareSheetEmails.
 */
export async function createCampaign(input: {
  name: string;
  accountId: string;
  projectId?: string | null;
  draftIds: string[];
  settings?: Partial<CampaignSettings>;
}): Promise<string> {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 200) || "Mailing";
  const checked = validateCampaignSettings(input.settings ?? {});
  if (!checked.ok) throw new CampaignError(checked.error);
  const s = checked.settings;
  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into email_campaigns ${tx({
        name,
        accountId: input.accountId,
        projectId: input.projectId ?? null,
        perHour: s.perHour,
        dailyCap: s.dailyCap,
        windowStart: s.windowStart,
        windowEnd: s.windowEnd,
        weekdaysOnly: s.weekdaysOnly,
        timezone: s.timezone,
      })}
      returning id
    `;
    if (input.draftIds.length) {
      await tx`
        update email_drafts set campaign_id = ${row.id}
         where id = any(${input.draftIds}::uuid[]) and campaign_id is null and status in ('proposed', 'failed')`;
    }
    return row.id;
  });
}

function settingsValues(s: CampaignSettings) {
  return {
    perHour: s.perHour,
    dailyCap: s.dailyCap,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    weekdaysOnly: s.weekdaysOnly,
    timezone: s.timezone,
  };
}

async function lockCampaign(tx: Tx, id: string) {
  if (!ID.test(id)) throw new CampaignError("Mailing not found.");
  const [row] = await tx<{ id: string; status: CampaignStatus; accountId: string; name: string }[]>`
    select id, status, account_id, name from email_campaigns where id = ${id} for update`;
  if (!row) throw new CampaignError("Mailing not found.");
  return row;
}

async function readCampaign(id: string): Promise<Campaign> {
  const campaign = await getCampaign(id);
  if (!campaign) throw new CampaignError("Mailing not found.");
  return campaign;
}

/**
 * THE OWNER'S APPROVAL ("Approve N and start sending"): validates the
 * settings (missing ones keep the campaign's), moves the campaign's proposed
 * and failed emails to queued — not the held-back ones, which the owner
 * re-approves one by one (requeueHeldDraft) — and sets it running. Allowed from draft,
 * paused, done and cancelled (approving the emails waiting again); refused
 * while running and when the account needs reconnecting. Nothing is sent
 * here: the cron sends queued emails gradually.
 */
export async function startCampaign(id: string, settings: Partial<CampaignSettings> = {}): Promise<Campaign> {
  await sql.begin(async (tx) => {
    const row = await lockCampaign(tx, id);
    if (row.status === "running") throw new CampaignError("This mailing is already sending.");
    const [account] = await tx<{ email: string; status: string }[]>`select email, status from gmail_accounts where id = ${row.accountId}`;
    if (!account || account.status !== "active") throw new CampaignError(`Reconnect ${account?.email ?? "the Gmail account"} in Settings first.`);
    const current = await tx<CampaignSettings[]>`
      select per_hour, daily_cap, window_start::int, window_end::int, weekdays_only, timezone from email_campaigns where id = ${id}`;
    const checked = validateCampaignSettings(settings, current[0] ?? DEFAULT_CAMPAIGN_SETTINGS);
    if (!checked.ok) throw new CampaignError(checked.error);
    // Held-back emails are not part of the approval: the owner checks each one ("Queue again", "Send now").
    const queued = await tx`
      update email_drafts set status = 'queued'
       where campaign_id = ${id}
         and (status = 'failed' or (status = 'proposed' and not starts_with(coalesce(error, ''), ${HELD_BACK_PREFIX})))`;
    const [{ waiting, held }] = await tx<{ waiting: number; held: number }[]>`
      select count(*) filter (where status = 'queued')::int as waiting,
             count(*) filter (where status = 'proposed' and starts_with(coalesce(error, ''), ${HELD_BACK_PREFIX}))::int as held
        from email_drafts where campaign_id = ${id}`;
    if (!queued.count && !waiting) {
      throw new CampaignError(
        held
          ? "Only held-back emails are left. Check each conversation, then use “Queue again” or “Send now” on it."
          : "There are no emails to send in this mailing.",
      );
    }
    await tx`
      update email_campaigns
         set ${tx(settingsValues(checked.settings))}, status = 'running', error = null, consecutive_failures = 0,
             started_at = coalesce(started_at, now()), finished_at = null
       where id = ${id}`;
  });
  return readCampaign(id);
}

/** Change how a campaign sends (or its name), in any status; queued emails stay queued. */
export async function updateCampaignSettings(id: string, settings: Partial<CampaignSettings> & { name?: string }): Promise<Campaign> {
  await sql.begin(async (tx) => {
    const row = await lockCampaign(tx, id);
    const current = await tx<CampaignSettings[]>`
      select per_hour, daily_cap, window_start::int, window_end::int, weekdays_only, timezone from email_campaigns where id = ${id}`;
    const { name, ...rest } = settings;
    const checked = validateCampaignSettings(rest, current[0]);
    if (!checked.ok) throw new CampaignError(checked.error);
    const clean = name?.replace(/\s+/g, " ").trim().slice(0, 200);
    if (name !== undefined && !clean) throw new CampaignError("Give the mailing a name.");
    await tx`
      update email_campaigns set ${tx({ ...settingsValues(checked.settings), ...(clean ? { name: clean } : {}) })}
       where id = ${row.id}`;
  });
  return readCampaign(id);
}

/** Stop sending for now; queued emails stay approved and wait. */
export async function pauseCampaign(id: string): Promise<Campaign> {
  await sql.begin(async (tx) => {
    const row = await lockCampaign(tx, id);
    if (row.status !== "running") throw new CampaignError("This mailing is not sending.");
    await tx`update email_campaigns set status = 'paused' where id = ${id}`;
  });
  return readCampaign(id);
}

/**
 * Resume a paused campaign: its queued emails are sent again (failed ones
 * stay failed; approve them with startCampaign or one by one). Clears the
 * pause reason and the failure count.
 */
export async function resumeCampaign(id: string): Promise<Campaign> {
  await sql.begin(async (tx) => {
    const row = await lockCampaign(tx, id);
    if (row.status !== "paused") throw new CampaignError("This mailing is not paused.");
    const [account] = await tx<{ email: string; status: string }[]>`select email, status from gmail_accounts where id = ${row.accountId}`;
    if (!account || account.status !== "active") throw new CampaignError(`Reconnect ${account?.email ?? "the Gmail account"} in Settings first.`);
    const [{ waiting }] = await tx<{ waiting: number }[]>`
      select count(*)::int as waiting from email_drafts where campaign_id = ${id} and status = 'queued'`;
    await tx`
      update email_campaigns
         set status = ${waiting ? "running" : "done"}, error = null, consecutive_failures = 0,
             finished_at = ${waiting ? null : new Date()}
       where id = ${id}`;
  });
  return readCampaign(id);
}

/**
 * Cancel: queued emails go back to waiting for approval (proposed) and the
 * campaign stops for good (start it again to re-approve). An email being sent
 * at this instant finishes.
 */
export async function cancelCampaign(id: string): Promise<Campaign> {
  await sql.begin(async (tx) => {
    const row = await lockCampaign(tx, id);
    if (row.status === "done" || row.status === "cancelled") return;
    await tx`update email_drafts set status = 'proposed' where campaign_id = ${id} and status = 'queued'`;
    await tx`update email_campaigns set status = 'cancelled', finished_at = now() where id = ${id}`;
  });
  return readCampaign(id);
}

/**
 * Discard every unsent email of the campaign (proposed, queued, failed; their
 * Gmail drafts are deleted) and cancel it. Returns how many were discarded.
 */
export async function discardCampaign(id: string): Promise<number> {
  const drafts = await sql.begin(async (tx) => {
    const row = await lockCampaign(tx, id);
    const rows = await tx<{ accountId: string; gmailDraftId: string | null }[]>`
      update email_drafts set status = 'discarded'
       where campaign_id = ${id} and status in ('proposed', 'queued', 'failed')
      returning account_id, gmail_draft_id`;
    if (row.status !== "done") await tx`update email_campaigns set status = 'cancelled', finished_at = coalesce(finished_at, now()) where id = ${id}`;
    return rows;
  });
  for (const d of drafts) {
    if (!d.gmailDraftId) continue;
    try {
      await deleteGmailDraft(d.accountId, d.gmailDraftId);
    } catch (error) {
      console.warn("Could not delete a discarded campaign email's Gmail draft:", error);
    }
  }
  return drafts.length;
}

/**
 * The owner checked a held-back email ("Queue again"): it goes back in the
 * queue of its campaign when that is sending or paused, else it waits for the
 * campaign's next approval like any other email. Either way the sender's
 * "did they get in touch since?" check now starts from this moment, so the
 * contact that held it back does not hold it back again. Returns whether it
 * is queued.
 */
export async function requeueHeldDraft(draftId: string): Promise<{ campaignId: string; queued: boolean }> {
  if (!ID.test(draftId)) throw new CampaignError("Email not found.");
  const [found] = await sql<{ campaignId: string | null }[]>`select campaign_id from email_drafts where id = ${draftId}`;
  if (!found) throw new CampaignError("Email not found.");
  if (!found.campaignId) throw new CampaignError("This email is not part of a mailing.");
  const campaignId = found.campaignId;
  return sql.begin(async (tx) => {
    // Campaign first, then the email: the same order as startCampaign / cancelCampaign.
    const campaign = await lockCampaign(tx, campaignId);
    const [draft] = await tx<{ campaignId: string | null; status: DraftStatus; error: string | null }[]>`
      select campaign_id, status, error from email_drafts where id = ${draftId} for update`;
    if (!draft || draft.campaignId !== campaignId) throw new CampaignError("This email is no longer part of the mailing.");
    if (draft.status !== "proposed" || !draft.error?.startsWith(HELD_BACK_PREFIX)) throw new CampaignError("This email is not held back any more.");
    const queued = campaign.status === "running" || campaign.status === "paused";
    await tx`
      update email_drafts set status = ${queued ? "queued" : "proposed"}, error = null, hold_cleared_at = now()
       where id = ${draftId}`;
    return { campaignId, queued };
  });
}

/** ACCOUNT_DAILY_SEND_CAP, re-exported for server code. */
export { ACCOUNT_DAILY_SEND_CAP };

/**
 * Emails per campaign that the sender held back (back to "proposed" because
 * the contact got in touch after they were prepared), for the Approvals cards.
 */
export async function heldBackCounts(campaignIds: string[]): Promise<Record<string, number>> {
  const ids = campaignIds.filter((id) => ID.test(id));
  if (!ids.length) return {};
  const rows = await sql<{ campaignId: string; n: number }[]>`
    select campaign_id, count(*)::int as n from email_drafts
     where campaign_id = any(${ids}::uuid[]) and status = 'proposed' and starts_with(coalesce(error, ''), ${HELD_BACK_PREFIX})
     group by campaign_id`;
  return Object.fromEntries(rows.map((r) => [r.campaignId, r.n]));
}
