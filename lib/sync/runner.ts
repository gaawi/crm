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
 * Fire-and-forget request to POST /api/sync/{accountId}?mode=… on this
 * deployment (Authorization: Bearer CRON_SECRET). Awaits only the 202
 * acknowledgement (short timeout); errors are logged, never thrown.
 */
export async function triggerAccountJob(accountId: string, mode: "backfill" | "sync"): Promise<void> {
  void accountId;
  void mode;
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
  options: { deadline: number },
): Promise<unknown> {
  void accountId;
  void mode;
  void options;
  throw new Error("TODO");
}

/**
 * Daily cron: for every active account, renew watches expiring within 48 h,
 * run a catch-up incremental sync, and resume unfinished imports (via
 * triggerAccountJob so each gets its own time budget).
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
