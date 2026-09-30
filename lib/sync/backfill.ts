import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { GmailApiError } from "@/lib/gmail/client";
import { buildBackfillQuery, parseGmailMessage, shouldSkipLabels } from "@/lib/gmail/parse";
import type { GmailListMessagesResponse, ParsedMessage } from "@/lib/gmail/types";
import {
  AccountAuthError,
  databaseSizeMb,
  getAccount,
  getSelfEmails,
  gmailClientFor,
  recordAccountError,
} from "@/lib/sync/accounts";
import { describeSyncError, isRateLimitError, summarizeFailures } from "@/lib/sync/errors";
import { existingMessageIds, ingestMessages } from "@/lib/sync/ingest";
import { acquireLease, extendLease, LEASE_SECONDS, releaseLease } from "@/lib/sync/locks";
import { errorMessage } from "@/lib/utils";

export interface BackfillResult {
  status: "done" | "progress" | "locked" | "skipped" | "error";
  scanned: number;
  imported: number;
  error?: string;
}

/** Message ids per messages.list page. */
const PAGE_SIZE = 100;
/**
 * Messages fetched and ingested per step. A page is processed in steps so the
 * deadline is checked often and progress is saved as it is made.
 */
const FETCH_BATCH = 25;

/**
 * One resumable chunk of the historical import (see docs/SYNC_SPEC.md).
 * Stops before `deadline`. "skipped" when the account is not active or the
 * import is already done; "locked" when another chunk holds the lease.
 * When time runs out in the middle of a page, the page token is not advanced:
 * the page is listed again next time and its stored ids are skipped.
 */
export async function runBackfillChunk(
  accountId: string,
  options: { deadline: number; fetchImpl?: typeof fetch },
): Promise<BackfillResult> {
  const account = await getAccount(accountId);
  if (!account || account.status !== "active" || account.backfillStatus === "done") {
    return { status: "skipped", scanned: 0, imported: 0 };
  }
  if (!(await acquireLease(accountId, "backfill", LEASE_SECONDS))) {
    return { status: "locked", scanned: 0, imported: 0 };
  }

  let scanned = 0;
  let imported = 0;
  /** Imported from the current page but not yet added to backfill_imported. */
  let pending = 0;
  const failures: { gmailMessageId: string; error: string }[] = [];

  const savePartial = async () => {
    if (pending === 0) return;
    const summary = summarizeFailures(failures);
    await sql`
      update gmail_accounts
         set backfill_imported = backfill_imported + ${pending},
             last_error = ${summary}, last_error_at = ${summary ? new Date() : null}
       where id = ${accountId}
    `;
    imported += pending;
    pending = 0;
  };

  try {
    const sizeMb = await databaseSizeMb();
    if (sizeMb >= env.dbSizeLimitMb) {
      const error =
        `Import paused: database is at ${sizeMb} MB (limit ${env.dbSizeLimitMb} MB). ` +
        "Free up space or raise DB_SIZE_LIMIT_MB, then resume the import.";
      await sql`
        update gmail_accounts set backfill_status = 'error', last_error = ${error}, last_error_at = now()
         where id = ${accountId}
      `;
      return { status: "error", scanned, imported, error };
    }

    await sql`
      update gmail_accounts
         set backfill_status = 'running', backfill_started_at = coalesce(backfill_started_at, now())
       where id = ${accountId}
    `;

    const client = gmailClientFor(accountId, options.fetchImpl);
    const selfEmails = await getSelfEmails();
    const skipCategories = env.skipCategories;
    const query = account.backfillQuery ?? buildBackfillQuery(skipCategories, env.backfillQuery);
    let pageToken = account.backfillPageToken;
    let restarted = false;

    while (Date.now() < options.deadline) {
      let page: GmailListMessagesResponse;
      try {
        page = await client.listMessages({
          q: query,
          pageToken: pageToken ?? undefined,
          maxResults: PAGE_SIZE,
          includeSpamTrash: false,
        });
      } catch (error) {
        // An expired / invalid page token: start over from the newest mail once
        // (stored ids are skipped quickly).
        if (error instanceof GmailApiError && error.status === 400 && pageToken && !restarted) {
          restarted = true;
          pageToken = null;
          await sql`update gmail_accounts set backfill_page_token = null where id = ${accountId}`;
          continue;
        }
        throw error;
      }

      const ids = [...new Set((page.messages ?? []).map((m) => m?.id).filter((id): id is string => Boolean(id)))];
      const stored = await existingMessageIds(accountId, ids);
      const toFetch = ids.filter((id) => !stored.has(id));

      let complete = true;
      for (let i = 0; i < toFetch.length; i += FETCH_BATCH) {
        if (i > 0 && Date.now() >= options.deadline) {
          complete = false;
          break;
        }
        const fetched = await client.getMessages(toFetch.slice(i, i + FETCH_BATCH));
        const parsed: ParsedMessage[] = [];
        for (const message of fetched) {
          if (shouldSkipLabels(message.labelIds ?? [], skipCategories)) continue;
          try {
            parsed.push(parseGmailMessage(message, { selfEmails }));
          } catch (error) {
            failures.push({ gmailMessageId: message.id, error: errorMessage(error) });
          }
        }
        if (parsed.length > 0) {
          const result = await ingestMessages(accountId, parsed, selfEmails);
          pending += result.stored;
          failures.push(...result.failed);
        }
      }

      if (!complete) {
        await savePartial();
        break;
      }

      const next = page.nextPageToken || null;
      const done = next === null;
      const summary = summarizeFailures(failures);
      await sql`
        update gmail_accounts
           set backfill_page_token = ${next},
               backfill_scanned = backfill_scanned + ${ids.length},
               backfill_imported = backfill_imported + ${pending},
               backfill_estimate = greatest(coalesce(backfill_estimate, 0), backfill_scanned + ${ids.length}),
               last_error = ${summary},
               last_error_at = ${summary ? new Date() : null},
               backfill_status = case when ${done}::boolean then 'done' else backfill_status end,
               backfill_completed_at = case when ${done}::boolean then now() else backfill_completed_at end
         where id = ${accountId}
      `;
      scanned += ids.length;
      imported += pending;
      pending = 0;

      if (done) return { status: "done", scanned, imported, ...(summary ? { error: summary } : {}) };
      await extendLease(accountId, "backfill", LEASE_SECONDS);
      pageToken = next;
    }
    const summary = summarizeFailures(failures);
    return { status: "progress", scanned, imported, ...(summary ? { error: summary } : {}) };
  } catch (error) {
    await savePartial().catch(() => undefined);
    if (error instanceof AccountAuthError) return { status: "error", scanned, imported, error: error.message };
    const message = describeSyncError(error);
    await recordAccountError(accountId, error).catch(() => undefined);
    // Quota still exhausted after the client's retries: progress is saved and
    // the import stays 'running', so the next chunk simply continues.
    if (isRateLimitError(error)) return { status: "progress", scanned, imported, error: message };
    return { status: "error", scanned, imported, error: message };
  } finally {
    await releaseLease(accountId, "backfill").catch(() => undefined);
  }
}

/**
 * Restart the import from the beginning with the default query (already
 * stored messages are skipped quickly). Counters are kept.
 */
export async function resetBackfill(accountId: string): Promise<void> {
  await sql`
    update gmail_accounts
       set backfill_page_token = null,
           backfill_status = 'pending',
           backfill_query = ${buildBackfillQuery(env.skipCategories, env.backfillQuery)},
           backfill_completed_at = null
     where id = ${accountId}
  `;
}
