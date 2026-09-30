import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { AccountAuthError, getAccount, gmailClientFor } from "@/lib/sync/accounts";
import { describeSyncError, MAX_ERROR_CHARS } from "@/lib/sync/errors";
import { truncate } from "@/lib/utils";

const WATCH_ERROR_PREFIX = "Live sync unavailable: ";

/**
 * users.watch on the account's whole mailbox (no label filter) when
 * GMAIL_PUBSUB_TOPIC is set; stores watch_expires_at / watch_renewed_at.
 * Never moves history_id backwards (only sets it when null). Errors are stored
 * as last_error "Live sync unavailable: …". Returns false when push is not
 * configured or the watch failed.
 */
export async function ensureWatch(accountId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const topicName = env.pubsubTopic;
  if (!topicName) return false;
  const account = await getAccount(accountId);
  if (!account || account.status !== "active") return false;

  try {
    const response = await gmailClientFor(accountId, options.fetchImpl).watch({ topicName });
    const expirationMs = Number(response?.expiration);
    const expiresAt = Number.isFinite(expirationMs) && expirationMs > 0 ? new Date(expirationMs) : null;
    const historyId = /^\d+$/.test(String(response?.historyId ?? "")) ? String(response.historyId) : null;
    await sql`
      update gmail_accounts
         set watch_expires_at = ${expiresAt},
             watch_renewed_at = now(),
             history_id = coalesce(history_id, ${historyId}::bigint),
             last_error = case when last_error like ${`${WATCH_ERROR_PREFIX}%`} then null else last_error end,
             last_error_at = case when last_error like ${`${WATCH_ERROR_PREFIX}%`} then null else last_error_at end
       where id = ${accountId}
    `;
    return true;
  } catch (error) {
    if (!(error instanceof AccountAuthError)) {
      const message = truncate(`${WATCH_ERROR_PREFIX}${describeSyncError(error)}`, MAX_ERROR_CHARS);
      await sql`update gmail_accounts set last_error = ${message}, last_error_at = now() where id = ${accountId}`;
    }
    return false;
  }
}

/** users.stop — best effort (never throws); clears watch_expires_at. */
export async function stopWatch(accountId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  try {
    const account = await getAccount(accountId);
    if (!account) return;
    if (account.status === "active" && (account.watchExpiresAt || env.pubsubTopic)) {
      await gmailClientFor(accountId, options.fetchImpl).stop();
    }
  } catch {
    // Best effort: an expired watch or revoked token is fine.
  }
  try {
    await sql`update gmail_accounts set watch_expires_at = null where id = ${accountId} and watch_expires_at is not null`;
  } catch {
    // Best effort.
  }
}
