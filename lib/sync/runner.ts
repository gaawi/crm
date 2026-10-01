import "server-only";
import { sql } from "@/lib/db";
import { runAutopilotIfDue } from "@/lib/ai/autopilot";
import { recoverStaleDrafts } from "@/lib/queries/drafts";
import { getAccountByEmail, listAccounts, reconcileSelfContacts, refreshAliases } from "@/lib/sync/accounts";
import { runBackfillChunk, type BackfillResult } from "@/lib/sync/backfill";
import { describeSyncError } from "@/lib/sync/errors";
import { runIncrementalSync, type SyncResult } from "@/lib/sync/incremental";
import { MAX_CHAIN_HOPS, triggerAccountJob } from "@/lib/sync/trigger";
import { ensureWatch } from "@/lib/sync/watch";

/**
 * Orchestration shared by the route handlers.
 */

/** Seconds of the route's maxDuration kept free for cleanup after a deadline. */
export const DEADLINE_MARGIN_MS = 25_000;

/** Deadline (epoch ms) for work started now inside a route with `maxDurationSeconds`. */
export function deadlineFor(maxDurationSeconds: number, start: number = Date.now()): number {
  return start + maxDurationSeconds * 1000 - DEADLINE_MARGIN_MS;
}

/**
 * Vercel blocks a function that keeps calling itself (508 after a few hops),
 * so chains of self-requests are capped; the cron / Settings page / push
 * notifications start fresh chains. (Defined in lib/sync/trigger.ts.)
 */
export { MAX_CHAIN_HOPS };

/**
 * Request POST /api/sync/{accountId}?mode=… on this deployment
 * (Authorization: Bearer CRON_SECRET, header x-crm-hop: hop). Awaits only the
 * 202 acknowledgement (10 s timeout). Returns false (and records last_error)
 * when the request was not accepted; never throws. (Defined in
 * lib/sync/trigger.ts so the sync modules can use it without an import cycle.)
 */
export { triggerAccountJob };

function normalizeHop(hop: number | undefined): number {
  const value = Math.floor(Number(hop ?? 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Body of /api/sync/{accountId}: run the requested job until the deadline.
 * backfill: runBackfillChunk; if it made progress, is not done and
 * hop < MAX_CHAIN_HOPS, chain with triggerAccountJob(accountId, "backfill", hop + 1).
 * sync: runIncrementalSync (which chains itself when out of time).
 */
export async function runAccountJob(
  accountId: string,
  mode: "backfill" | "sync",
  options: { deadline: number; hop?: number; fetchImpl?: typeof fetch },
): Promise<BackfillResult | SyncResult> {
  const hop = normalizeHop(options.hop);
  if (mode === "backfill") {
    const result = await runBackfillChunk(accountId, { deadline: options.deadline, fetchImpl: options.fetchImpl });
    const progressed = result.status === "progress" && (result.scanned > 0 || result.imported > 0);
    if (progressed && hop < MAX_CHAIN_HOPS) {
      await triggerAccountJob(accountId, "backfill", { hop: hop + 1, fetchImpl: options.fetchImpl });
    }
    return result;
  }
  return runIncrementalSync(accountId, { deadline: options.deadline, fetchImpl: options.fetchImpl, hop });
}

export interface CronSummary {
  accounts: {
    id: string;
    email: string;
    watch: boolean;
    syncTriggered: boolean;
    backfillTriggered: boolean;
  }[];
  selfAddressesRemoved: number;
  autopilot: unknown;
  errors: string[];
}

/**
 * Cron (Vercel Cron and/or Supabase pg_cron): renew every active account's
 * watch (idempotent; Google recommends daily), refresh aliases, reconcile self
 * contacts, then fan out one job per account (sync when last_synced_at is older
 * than 5 minutes; backfill when the import is unfinished and not locked), then
 * runAutopilotIfDue (lib/ai/autopilot).
 */
export async function runCron(options: { deadline: number; fetchImpl?: typeof fetch }): Promise<CronSummary> {
  const summary: CronSummary = { accounts: [], selfAddressesRemoved: 0, autopilot: null, errors: [] };
  const { fetchImpl } = options;

  const watches = new Map<string, boolean>();
  for (const account of await listAccounts({ activeOnly: true })) {
    if (Date.now() >= options.deadline) break;
    try {
      watches.set(account.id, await ensureWatch(account.id, { fetchImpl }));
      await refreshAliases(account.id, { fetchImpl });
    } catch (error) {
      summary.errors.push(`${account.email}: ${describeSyncError(error)}`);
    }
  }

  try {
    summary.selfAddressesRemoved = await reconcileSelfContacts();
  } catch (error) {
    summary.errors.push(`reconcile: ${describeSyncError(error)}`);
  }

  // Re-read: renewing a watch or refreshing a token may have changed a status.
  const due = await sql<{ id: string; email: string; syncDue: boolean; backfillDue: boolean }[]>`
    select id, email,
           (last_synced_at is null or last_synced_at < now() - interval '5 minutes') as sync_due,
           (backfill_status in ('pending', 'running', 'error')
             and (backfill_locked_until is null or backfill_locked_until < now())) as backfill_due
      from gmail_accounts
     where status = 'active'
     order by created_at
  `;
  for (const account of due) {
    const syncTriggered = account.syncDue ? await triggerAccountJob(account.id, "sync", { fetchImpl }) : false;
    const backfillTriggered = account.backfillDue ? await triggerAccountJob(account.id, "backfill", { fetchImpl }) : false;
    summary.accounts.push({
      id: account.id,
      email: account.email,
      watch: watches.get(account.id) ?? false,
      syncTriggered,
      backfillTriggered,
    });
  }

  try {
    await recoverStaleDrafts();
    summary.autopilot = await runAutopilotIfDue({ deadline: options.deadline });
  } catch (error) {
    summary.errors.push(`autopilot: ${describeSyncError(error)}`);
  }
  return summary;
}

/**
 * Pub/Sub push: find the account by emailAddress and run an incremental sync.
 * The payload's historyId is never trusted (it only identifies the account);
 * a stalled import (unfinished, lease free) is resumed as well.
 */
export async function handlePushNotification(
  payload: { emailAddress: string; historyId: string },
  options: { deadline: number; fetchImpl?: typeof fetch },
): Promise<{ status: "ignored" | "synced"; account?: string; sync?: SyncResult; backfillTriggered?: boolean }> {
  const email = typeof payload?.emailAddress === "string" ? payload.emailAddress.trim().toLowerCase() : "";
  if (!email) return { status: "ignored" };
  const account = await getAccountByEmail(email);
  if (!account || account.status !== "active") return { status: "ignored", account: email };

  const sync = await runIncrementalSync(account.id, { deadline: options.deadline, fetchImpl: options.fetchImpl });
  let backfillTriggered = false;
  if (sync.status !== "recovered") {
    const [row] = await sql<{ stalled: boolean }[]>`
      select (status = 'active' and backfill_status in ('pending', 'running')
               and (backfill_locked_until is null or backfill_locked_until < now())) as stalled
        from gmail_accounts where id = ${account.id}
    `;
    if (row?.stalled) {
      backfillTriggered = await triggerAccountJob(account.id, "backfill", { fetchImpl: options.fetchImpl });
    }
  }
  return { status: "synced", account: email, sync, backfillTriggered };
}

/**
 * Sync-on-visit: incremental sync for active accounts not synced in the last
 * 10 minutes (and not being synced right now), and a fresh chain for stalled
 * imports. Called from after() in the app layout; never throws.
 */
export async function syncStaleAccounts(options: {
  deadline: number;
  maxAgeMinutes?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  try {
    const maxAge = Math.max(1, Math.floor(options.maxAgeMinutes ?? 10));
    const rows = await sql<{ id: string; syncDue: boolean; backfillStalled: boolean }[]>`
      select id,
             ((last_synced_at is null or last_synced_at < now() - make_interval(mins => ${maxAge}))
               and (sync_locked_until is null or sync_locked_until < now())) as sync_due,
             (backfill_status in ('pending', 'running')
               and (backfill_locked_until is null or backfill_locked_until < now())) as backfill_stalled
        from gmail_accounts
       where status = 'active'
    `;
    await Promise.allSettled(
      rows.map(async (row) => {
        if (row.backfillStalled) await triggerAccountJob(row.id, "backfill", { fetchImpl: options.fetchImpl });
        if (row.syncDue) await runIncrementalSync(row.id, { deadline: options.deadline, fetchImpl: options.fetchImpl });
      }),
    );
  } catch (error) {
    console.warn("syncStaleAccounts failed:", describeSyncError(error));
  }
}
