import "server-only";
import { sql } from "@/lib/db";
import { approveAndSend, DraftUnavailableError } from "@/lib/ai/approvals";
import { accountSentLast24h, sentToday } from "@/lib/campaigns/campaigns";
import { inSendingWindow, jitteredGapMs } from "@/lib/campaigns/schedule";
import { ACCOUNT_DAILY_SEND_CAP } from "@/lib/campaigns/types";
import { formatDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { canCompose } from "@/lib/gmail/oauth";
import type { CampaignStatus } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

/**
 * The gradual sender, run by the cron (lib/sync/runner.ts → runCron, every 5
 * minutes). For each RUNNING campaign it takes a lease, then sends its oldest
 * QUEUED emails while every rule allows it:
 *
 *   - inside the sending window in the campaign's timezone (weekdays only
 *     when asked);
 *   - at least 3600 / per_hour seconds (±20%, stable per send) after the
 *     previous send — within a run it waits for the gap while its lease
 *     (4 minutes, minus a margin) and the deadline allow;
 *   - under the campaign's daily cap (its timezone's day) and the account's
 *     ACCOUNT_DAILY_SEND_CAP over 24 hours (all campaigns together);
 *   - at most ceil(per_hour / 12) sends per run.
 *
 * Right before each send it re-checks the email: still queued in this
 * running campaign (atomically, in approveAndSend's status transition), and
 * nobody wrote or talked since it was prepared — otherwise it goes back to
 * the owner (proposed) with the reason. Sending goes through approveAndSend
 * (the approved version overwrites the Gmail draft first; no duplicates).
 * Three failures in a row, or an account to reconnect, pause the campaign.
 * Nothing that is not queued in a running campaign is ever sent here.
 */

/** How long a run owns a campaign. */
export const CAMPAIGN_LEASE_MS = 4 * 60_000;
/** Kept free at the end of the lease. */
const LEASE_SAFETY_MS = 30_000;
/** Failed sends in a row that pause a campaign. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface CampaignRunResult {
  id: string;
  name: string;
  sent: number;
  /** Emails returned to the owner because the contact wrote / was contacted since they were prepared. */
  held: number;
  failed: number;
  /** Status after the run. */
  status: CampaignStatus;
  /** Why it stopped sending in this run (null = nothing left to do or the per-run limit). */
  waiting: "locked" | "window" | "gap" | "daily_cap" | "account_cap" | "account" | "failure" | null;
}

export interface RunCampaignsSummary {
  campaigns: CampaignRunResult[];
  sent: number;
  held: number;
  failed: number;
  /** Queued emails whose campaign is gone or no longer approved, returned to the owner. */
  released: number;
  errors: string[];
}

export interface RunCampaignsOptions {
  /** The scheduler's clock at the start of the run (tests); default now. It advances with real time. */
  now?: Date;
  /** Epoch ms (real time) after which no new send starts. */
  deadline: number;
  /** Waits inside a run (tests pass one that returns at once; the clock then jumps ahead by the wait). */
  sleep?: (ms: number) => Promise<void>;
}

interface LeasedCampaign {
  id: string;
  name: string;
  accountId: string;
  perHour: number;
  dailyCap: number;
  windowStart: number;
  windowEnd: number;
  weekdaysOnly: boolean;
  timezone: string;
  lastSentAt: Date | null;
  consecutiveFailures: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runCampaigns(options: RunCampaignsOptions): Promise<RunCampaignsSummary> {
  const summary: RunCampaignsSummary = { campaigns: [], sent: 0, held: 0, failed: 0, released: 0, errors: [] };
  const t0 = Date.now();
  const base = (options.now ?? new Date()).getTime();
  let floor = base;
  const clock = () => new Date(Math.max(base + (Date.now() - t0), floor));
  const sleep = async (ms: number) => {
    const target = clock().getTime() + ms;
    await (options.sleep ?? realSleep)(ms);
    floor = Math.max(floor, target);
  };

  // Queued emails can only wait in a running or paused campaign.
  const released = await sql`
    update email_drafts d
       set status = 'proposed', error = 'Its campaign is no longer sending. Approve it again to send it.'
     where d.status = 'queued'
       and (d.campaign_id is null
            or not exists (select 1 from email_campaigns c where c.id = d.campaign_id and c.status in ('running', 'paused')))`;
  summary.released = released.count;

  const running = await sql<{ id: string; name: string }[]>`
    select id, name from email_campaigns where status = 'running' order by started_at nulls last, created_at, id`;
  for (const { id, name } of running) {
    if (Date.now() >= options.deadline) break;
    const [campaign] = await sql<(LeasedCampaign & { lease: string })[]>`
      update email_campaigns
         set locked_until = now() + make_interval(secs => ${CAMPAIGN_LEASE_MS / 1000})
       where id = ${id} and status = 'running' and (locked_until is null or locked_until < now())
      returning id, name, account_id, per_hour, daily_cap, window_start, window_end, weekdays_only, timezone,
                last_sent_at, consecutive_failures, locked_until::text as lease`;
    if (!campaign) {
      summary.campaigns.push({ id, name, sent: 0, held: 0, failed: 0, status: "running", waiting: "locked" });
      continue;
    }
    try {
      const result = await runOne(campaign, { clock, sleep, deadline: options.deadline });
      summary.campaigns.push(result);
      summary.sent += result.sent;
      summary.held += result.held;
      summary.failed += result.failed;
    } catch (error) {
      summary.errors.push(`${name}: ${errorMessage(error)}`);
    } finally {
      // Only our own lease: if this run overran it, another run may hold the campaign now.
      await sql`update email_campaigns set locked_until = null where id = ${id} and locked_until::text = ${campaign.lease}::text`;
    }
  }
  return summary;
}

async function pause(id: string, error: string): Promise<void> {
  await sql`update email_campaigns set status = 'paused', error = ${error} where id = ${id} and status = 'running'`;
}

async function campaignStatus(id: string): Promise<CampaignStatus | null> {
  const [row] = await sql<{ status: CampaignStatus }[]>`select status from email_campaigns where id = ${id}`;
  return row?.status ?? null;
}

/** The account cannot send: a sentence for the owner, else null. */
async function accountProblem(accountId: string): Promise<string | null> {
  const [account] = await sql<{ email: string; status: string; scopes: string[] }[]>`
    select email, status, scopes from gmail_accounts where id = ${accountId}`;
  if (!account) return "The Gmail account of this campaign is no longer connected.";
  if (account.status !== "active" || !canCompose(account.scopes)) return `Reconnect ${account.email} in Settings to resume sending.`;
  return null;
}

interface QueuedDraft {
  id: string;
  createdAt: Date;
  /** Where the "did they get in touch since?" check starts: when it was prepared, or when the owner queued it again after a hold. */
  checkFrom: Date;
  contactId: string | null;
  opportunityId: string | null;
  toEmails: string[];
  contactName: string | null;
}

const TOUCH_WORDS: Record<string, string> = { call: "a call", whatsapp: "a WhatsApp", meeting: "a meeting", email: "an email" };

/**
 * Did the contact write (or did anyone talk to them) since the email was
 * prepared (or since the owner queued it again after a hold)? Inbound mail from the contact or the email's recipients (not
 * automated), mail I sent them myself, or a call / WhatsApp / meeting /
 * hand-logged email on the contact or the row. Returns the reason, or null.
 */
async function holdReason(draft: QueuedDraft): Promise<string | null> {
  const [touch] = await sql<{ source: string; at: Date }[]>`
    with addresses as (
      select ce.email from contact_emails ce where ce.contact_id = ${draft.contactId}
      union
      select unnest(${draft.toEmails}::text[])
    )
    select * from (
      select case when m.direction = 'inbound' then 'inbound' else 'outbound' end as source, m.sent_at as at
        from messages m
        join message_participants mp on mp.message_id = m.id
       where mp.email in (select email from addresses)
         and m.sent_at > ${draft.checkFrom}
         and ((m.direction = 'inbound' and mp.role in ('from', 'reply_to') and not m.is_automated)
              or (m.direction = 'outbound' and mp.role in ('to', 'cc')))
      union all
      select a.kind, a.occurred_at
        from activities a
       where a.kind in ('email', 'call', 'whatsapp', 'meeting')
         and a.occurred_at > ${draft.checkFrom}
         and (a.contact_id = ${draft.contactId} or a.opportunity_id = ${draft.opportunityId})
    ) t
    order by at
    limit 1
  `;
  if (!touch) return null;
  const name = draft.contactName || draft.toEmails[0] || "This contact";
  const date = formatDate(touch.at, env.timezone);
  if (touch.source === "inbound") return `Held back: ${name} wrote to you on ${date} — check before sending.`;
  if (touch.source === "outbound") return `Held back: you emailed ${name} on ${date} — check before sending.`;
  return `Held back: ${TOUCH_WORDS[touch.source] ?? "an activity"} with ${name} was logged on ${date} — check before sending.`;
}

async function oldestQueued(campaignId: string): Promise<QueuedDraft | null> {
  const [draft] = await sql<QueuedDraft[]>`
    select d.id, d.created_at, greatest(d.created_at, d.hold_cleared_at) as check_from, d.contact_id, d.opportunity_id, d.to_emails,
           coalesce(nullif(btrim(c.name), ''),
                    (select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1)) as contact_name
      from email_drafts d
      left join contacts c on c.id = d.contact_id
     where d.campaign_id = ${campaignId} and d.status = 'queued'
     order by d.created_at, d.id
     limit 1`;
  return draft ?? null;
}

async function runOne(
  c: LeasedCampaign,
  ctx: { clock: () => Date; sleep: (ms: number) => Promise<void>; deadline: number },
): Promise<CampaignRunResult> {
  const result: CampaignRunResult = { id: c.id, name: c.name, sent: 0, held: 0, failed: 0, status: "running", waiting: null };
  const window = { windowStart: Number(c.windowStart), windowEnd: Number(c.windowEnd), weekdaysOnly: c.weekdaysOnly, timezone: c.timezone };
  const maxSends = Math.ceil(c.perHour / 12);
  const leaseEnd = ctx.clock().getTime() + CAMPAIGN_LEASE_MS - LEASE_SAFETY_MS;
  let lastSentAt = c.lastSentAt;
  let failures = c.consecutiveFailures;

  const problem = await accountProblem(c.accountId);
  if (problem) {
    await pause(c.id, problem);
    return { ...result, status: "paused", waiting: "account" };
  }

  for (let guard = 0; result.sent < maxSends && guard < 500; guard++) {
    if (Date.now() >= ctx.deadline) break;
    const draft = await oldestQueued(c.id);
    if (!draft) {
      const done = await sql`
        update email_campaigns set status = 'done', finished_at = ${ctx.clock()}
         where id = ${c.id} and status = 'running'
           and not exists (select 1 from email_drafts d where d.campaign_id = ${c.id} and d.status in ('queued', 'sending'))`;
      if (done.count) result.status = "done";
      break;
    }

    const now = ctx.clock();
    if (!inSendingWindow(window, now)) {
      result.waiting = "window";
      break;
    }
    if ((await sentToday(sql, c, now)) >= c.dailyCap) {
      result.waiting = "daily_cap";
      break;
    }
    if ((await accountSentLast24h(sql, c.accountId, now)) >= ACCOUNT_DAILY_SEND_CAP) {
      result.waiting = "account_cap";
      break;
    }
    if (lastSentAt) {
      const due = lastSentAt.getTime() + jitteredGapMs(c.perHour, `${c.id}:${lastSentAt.toISOString()}`);
      const wait = due - now.getTime();
      if (wait > 0) {
        // Wait inside this run only while the lease and the deadline allow; else the next run sends.
        if (now.getTime() + wait > leaseEnd || Date.now() + wait > ctx.deadline) {
          result.waiting = "gap";
          break;
        }
        await ctx.sleep(wait);
        // Paused or cancelled while waiting?
        if ((await campaignStatus(c.id)) !== "running") break;
        continue; // re-check the window and caps at the new time
      }
    }

    const hold = await holdReason(draft);
    if (hold) {
      const held = await sql`
        update email_drafts set status = 'proposed', error = ${hold}
         where id = ${draft.id} and status = 'queued' and campaign_id = ${c.id}`;
      if (held.count) result.held++;
      continue;
    }

    try {
      const sent = await approveAndSend(draft.id, { from: ["queued"], campaignId: c.id, now: ctx.clock });
      lastSentAt = sent.sentAt ?? ctx.clock();
      failures = 0;
      result.sent++;
      await sql`
        update email_campaigns set last_sent_at = ${lastSentAt}, consecutive_failures = 0, error = null where id = ${c.id}`;
    } catch (error) {
      if (error instanceof DraftUnavailableError) {
        // Paused / cancelled meanwhile, or the owner sent or discarded it: nothing was sent.
        if ((await campaignStatus(c.id)) !== "running") break;
        continue;
      }
      result.failed++;
      failures++;
      await sql`update email_campaigns set consecutive_failures = ${failures} where id = ${c.id}`;
      const reconnect = await accountProblem(c.accountId);
      if (reconnect) {
        await pause(c.id, reconnect);
        result.waiting = "account";
      } else {
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          await pause(c.id, `Paused after ${failures} failed sends in a row. Last error: ${errorMessage(error)}`);
        }
        result.waiting = "failure";
      }
      break; // back off until the next run
    }
  }

  result.status = (await campaignStatus(c.id)) ?? result.status;
  return result;
}
