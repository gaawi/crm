import "server-only";

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
 * notifications start fresh chains.
 */
export const MAX_CHAIN_HOPS = 3;

/**
 * Request POST /api/sync/{accountId}?mode=… on this deployment
 * (Authorization: Bearer CRON_SECRET, header x-crm-hop: hop). Awaits only the
 * 202 acknowledgement (10 s timeout). Returns false (and records last_error)
 * when the request was not accepted; never throws.
 */
export async function triggerAccountJob(accountId: string, mode: "backfill" | "sync", options: { hop?: number } = {}): Promise<boolean> {
  void accountId;
  void mode;
  void options;
  throw new Error("TODO");
}

/**
 * Body of /api/sync/{accountId}: run the requested job until the deadline.
 * backfill: runBackfillChunk; if it made progress and is not done, chain with
 * triggerAccountJob(accountId, "backfill").
 * sync: runIncrementalSync.
 */
export async function runAccountJob(
  accountId: string,
  mode: "backfill" | "sync",
  options: { deadline: number; hop?: number },
): Promise<unknown> {
  void accountId;
  void mode;
  void options;
  throw new Error("TODO");
}

/**
 * Cron (Vercel Cron and/or Supabase pg_cron): renew every active account's
 * watch (idempotent; Google recommends daily), refresh aliases, reconcile self
 * contacts, then fan out one job per account (sync when last_synced_at is older
 * than 5 minutes; backfill when the import is unfinished and not locked), then
 * runAutopilotIfDue (lib/ai/autopilot).
 */
export async function runCron(options: { deadline: number }): Promise<unknown> {
  void options;
  throw new Error("TODO");
}

/** Pub/Sub push: find the account by emailAddress and run an incremental sync. */
export async function handlePushNotification(
  payload: { emailAddress: string; historyId: string },
  options: { deadline: number },
): Promise<unknown> {
  void payload;
  void options;
  throw new Error("TODO");
}

/** Sync-on-visit: incremental sync for active accounts not synced in the last 10 minutes (called from after() in the app layout). */
export async function syncStaleAccounts(options: { deadline: number; maxAgeMinutes?: number }): Promise<void> {
  void options;
  throw new Error("TODO");
}
