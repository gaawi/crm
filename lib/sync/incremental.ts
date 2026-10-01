import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { GmailApiError, type GmailClient } from "@/lib/gmail/client";
import { buildBackfillQuery, parseGmailMessage, shouldSkipLabels } from "@/lib/gmail/parse";
import type { GmailHistoryRecord, GmailHistoryResponse, ParsedMessage } from "@/lib/gmail/types";
import { AccountAuthError, getAccount, getSelfEmails, gmailClientFor, recordAccountError } from "@/lib/sync/accounts";
import { describeSyncError, summarizeFailures } from "@/lib/sync/errors";
import {
  deleteMessages,
  existingMessageIds,
  ingestMessages,
  markMessagesDeleted,
  updateMessageLabels,
} from "@/lib/sync/ingest";
import {
  acquireLease,
  extendLease,
  LEASE_SECONDS,
  releaseLease,
  releaseSyncLeaseIfIdle,
  requestSync,
  takeSyncRequest,
} from "@/lib/sync/locks";
import { MAX_CHAIN_HOPS, triggerAccountJob } from "@/lib/sync/trigger";
import { errorMessage } from "@/lib/utils";

export interface SyncResult {
  status: "ok" | "queued" | "skipped" | "recovered" | "error";
  added: number;
  deleted: number;
  error?: string;
}

const HISTORY_TYPES = ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"] as const;
/** New messages with these labels are never imported (drafts, chats, scheduled sends). */
const IGNORED_ADDED_LABELS = new Set(["DRAFT", "CHAT", "SCHEDULED"]);
const INGEST_BATCH = 50;
const DAY_MS = 86_400_000;

/** What to do with one message after folding a page of history records. */
export type HistoryAction =
  | { kind: "upsert"; labels: string[] | null }
  | { kind: "labels"; labels: string[] | null }
  | { kind: "spam" }
  | { kind: "deleted" };

class HistoryExpiredError extends Error {
  constructor() {
    super("Gmail history id expired");
    this.name = "HistoryExpiredError";
  }
}

/**
 * Fold history records, in order, into one action per message id:
 * - messagesAdded: DRAFT/CHAT/SCHEDULED → ignored; otherwise upsert
 * - labelsAdded SPAM → spam (deleted from the CRM)
 * - labelsRemoved SPAM or TRASH → upsert (restored)
 * - other label changes → labels (the record's current labelIds)
 * - messagesDeleted → deleted (final)
 * A later label change keeps a pending upsert (with the newer labels) or spam.
 */
export function foldHistory(records: readonly GmailHistoryRecord[]): Map<string, HistoryAction> {
  const actions = new Map<string, HistoryAction>();
  const labelsOf = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.filter((l): l is string => typeof l === "string") : null;

  const set = (id: string, next: HistoryAction) => {
    const previous = actions.get(id);
    if (previous?.kind === "deleted") return;
    if (next.kind === "labels" && previous && previous.kind !== "labels") {
      if (previous.kind === "upsert") actions.set(id, { kind: "upsert", labels: next.labels ?? previous.labels });
      return;
    }
    actions.set(id, next);
  };

  for (const record of records ?? []) {
    for (const entry of record.messagesAdded ?? []) {
      const id = entry?.message?.id;
      if (!id) continue;
      const labels = labelsOf(entry.message.labelIds);
      if (labels?.some((label) => IGNORED_ADDED_LABELS.has(label))) continue;
      set(id, { kind: "upsert", labels });
    }
    for (const entry of record.labelsAdded ?? []) {
      const id = entry?.message?.id;
      if (!id) continue;
      const labels = labelsOf(entry.message.labelIds);
      if ((entry.labelIds ?? []).includes("SPAM")) set(id, { kind: "spam" });
      else set(id, { kind: "labels", labels });
    }
    for (const entry of record.labelsRemoved ?? []) {
      const id = entry?.message?.id;
      if (!id) continue;
      const labels = labelsOf(entry.message.labelIds);
      const removed = entry.labelIds ?? [];
      if (removed.includes("SPAM") || removed.includes("TRASH")) set(id, { kind: "upsert", labels });
      else set(id, { kind: "labels", labels });
    }
    for (const entry of record.messagesDeleted ?? []) {
      const id = entry?.message?.id;
      if (id) set(id, { kind: "deleted" });
    }
  }
  return actions;
}

/** Largest record id of a history page (compared as integers, never as strings). */
function maxRecordId(records: readonly GmailHistoryRecord[]): string | null {
  let max: bigint | null = null;
  for (const record of records) {
    if (!/^\d+$/.test(String(record?.id ?? ""))) continue;
    const id = BigInt(record.id);
    if (max === null || id > max) max = id;
  }
  return max === null ? null : max.toString();
}

interface ApplyContext {
  accountId: string;
  client: GmailClient;
  selfEmails: ReadonlySet<string>;
  failures: { gmailMessageId: string; error: string }[];
}

async function applyActions(ctx: ApplyContext, actions: Map<string, HistoryAction>): Promise<{ added: number; deleted: number }> {
  const { accountId, client } = ctx;
  const spam: string[] = [];
  const gone: string[] = [];
  const labelChanges: { gmailMessageId: string; labelIds: string[] }[] = [];
  const needLabels: string[] = [];
  const upserts: { id: string; labels: string[] | null }[] = [];

  for (const [id, action] of actions) {
    if (action.kind === "deleted") gone.push(id);
    else if (action.kind === "spam" || action.labels?.includes("SPAM")) spam.push(id);
    else if (action.kind === "labels") {
      if (action.labels) labelChanges.push({ gmailMessageId: id, labelIds: action.labels });
      else needLabels.push(id);
    } else upserts.push({ id, labels: action.labels });
  }

  let added = 0;
  let deleted = 0;
  if (spam.length) deleted += await deleteMessages(accountId, spam);
  if (gone.length) deleted += await markMessagesDeleted(accountId, gone);

  const stored = await existingMessageIds(accountId, [
    ...upserts.map((u) => u.id),
    ...needLabels,
    ...labelChanges.map((c) => c.gmailMessageId),
  ]);
  const toFetch = new Set<string>();
  for (const upsert of upserts) {
    if (!stored.has(upsert.id)) toFetch.add(upsert.id);
    else if (upsert.labels) labelChanges.push({ gmailMessageId: upsert.id, labelIds: upsert.labels });
    else needLabels.push(upsert.id);
  }

  // A label change on a message that was never stored is how a draft or a
  // scheduled email becomes sent mail (DRAFT/SCHEDULED removed, SENT added),
  // e.g. replies written in Gmail or the Gmail iPhone app: import it now if
  // it qualifies (excluded labels are re-checked on the fetched message).
  const storedChanges: { gmailMessageId: string; labelIds: string[] }[] = [];
  for (const change of labelChanges) {
    if (stored.has(change.gmailMessageId)) storedChanges.push(change);
    else if (!shouldSkipLabels(change.labelIds, env.skipCategories)) toFetch.add(change.gmailMessageId);
  }

  // Label changes whose record carried no labelIds: read the current labels.
  for (const id of needLabels) {
    if (!stored.has(id)) {
      toFetch.add(id);
      continue;
    }
    const message = await client.getMessage(id, "minimal");
    if (!message) gone.push(id);
    else if ((message.labelIds ?? []).includes("SPAM")) deleted += await deleteMessages(accountId, [id]);
    else storedChanges.push({ gmailMessageId: id, labelIds: message.labelIds ?? [] });
  }
  if (storedChanges.length) await updateMessageLabels(accountId, storedChanges);

  if (toFetch.size) {
    const ids = [...toFetch];
    const fetched = await client.getMessages(ids);
    const found = new Set(fetched.map((m) => m.id));
    const missing = ids.filter((id) => !found.has(id));
    // 404: deleted since the record was written.
    if (missing.length) deleted += await markMessagesDeleted(accountId, missing);

    const parsed: ParsedMessage[] = [];
    for (const message of fetched) {
      if (shouldSkipLabels(message.labelIds ?? [], env.skipCategories)) continue;
      try {
        parsed.push(parseGmailMessage(message, { selfEmails: ctx.selfEmails }));
      } catch (error) {
        ctx.failures.push({ gmailMessageId: message.id, error: errorMessage(error) });
      }
    }
    for (let i = 0; i < parsed.length; i += INGEST_BATCH) {
      const result = await ingestMessages(accountId, parsed.slice(i, i + INGEST_BATCH), ctx.selfEmails);
      added += result.inserted;
      ctx.failures.push(...result.failed);
    }
  }
  return { added, deleted };
}

async function listHistoryPage(client: GmailClient, startHistoryId: string, pageToken: string | undefined): Promise<GmailHistoryResponse> {
  try {
    // Small pages: the deadline is checked between pages, and a page is only checkpointed once applied.
    return await client.listHistory({ startHistoryId, pageToken, historyTypes: [...HISTORY_TYPES], maxResults: 100 });
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 404) throw new HistoryExpiredError();
    throw error;
  }
}

/**
 * The stored history id is too old for history.list (404). Read the current
 * history id FIRST, then schedule an import of everything since the last sync
 * (minus a day of overlap); the cursor jumps to that id, so nothing that
 * arrives meanwhile is missed.
 */
async function recoverExpiredHistory(accountId: string, client: GmailClient): Promise<void> {
  const profile = await client.getProfile();
  const [row] = await sql<
    { lastSyncedAt: Date | null; backfillCompletedAt: Date | null; createdAt: Date; backfillStatus: string }[]
  >`
    select last_synced_at, backfill_completed_at, created_at, backfill_status from gmail_accounts where id = ${accountId}
  `;
  if (!row) return;
  const base = row.lastSyncedAt ?? row.backfillCompletedAt ?? row.createdAt;
  const since = Math.max(0, Math.floor((base.getTime() - DAY_MS) / 1000));
  if (row.backfillStatus !== "done") {
    // The unfinished import rescans from the newest mail (stored ids are skipped).
    await sql`
      update gmail_accounts
         set backfill_page_token = null, history_id = greatest(history_id, ${profile.historyId}::bigint)
       where id = ${accountId}
    `;
  } else {
    const query = `${buildBackfillQuery(env.skipCategories, env.backfillQuery)} after:${since}`;
    await sql`
      update gmail_accounts
         set backfill_status = 'pending', backfill_query = ${query}, backfill_page_token = null,
             history_id = greatest(history_id, ${profile.historyId}::bigint)
       where id = ${accountId}
    `;
  }
}

/**
 * Incremental sync from gmail_accounts.history_id via history.list (see
 * docs/SYNC_SPEC.md). "queued" when another run holds the lease
 * (sync_requested is set so the holder runs again). "recovered" when the
 * history id had expired and a gap import was scheduled. When time runs out
 * with more to do, or a request arrived after the last pass, a follow-up sync
 * job is triggered (hop + 1, capped).
 */
export async function runIncrementalSync(
  accountId: string,
  options: { deadline: number; fetchImpl?: typeof fetch; hop?: number },
): Promise<SyncResult> {
  const account = await getAccount(accountId);
  if (!account || account.status !== "active") return { status: "skipped", added: 0, deleted: 0 };
  const client = gmailClientFor(accountId, options.fetchImpl);
  const hop = Math.max(0, Math.floor(options.hop ?? 0));

  if (account.historyId === null) {
    try {
      const profile = await client.getProfile();
      await sql`
        update gmail_accounts
           set history_id = coalesce(history_id, ${profile.historyId}::bigint), last_synced_at = now()
         where id = ${accountId}
      `;
      return { status: "ok", added: 0, deleted: 0 };
    } catch (error) {
      if (!(error instanceof AccountAuthError)) await recordAccountError(accountId, error).catch(() => undefined);
      return { status: "error", added: 0, deleted: 0, error: describeSyncError(error) };
    }
  }

  if (!(await acquireLease(accountId, "sync", LEASE_SECONDS))) {
    await requestSync(accountId);
    return { status: "queued", added: 0, deleted: 0 };
  }

  let held = true;
  let moreToDo = false;
  let added = 0;
  let deleted = 0;
  const failures: { gmailMessageId: string; error: string }[] = [];
  let result: SyncResult;

  try {
    const ctx: ApplyContext = { accountId, client, selfEmails: await getSelfEmails(), failures };
    for (;;) {
      await takeSyncRequest(accountId);
      const [cursor] = await sql<{ historyId: string | null }[]>`select history_id from gmail_accounts where id = ${accountId}`;
      const start = cursor?.historyId ?? account.historyId;
      let pageToken: string | undefined;
      let finished = false;

      for (;;) {
        const page = await listHistoryPage(client, start, pageToken);
        const records = page.history ?? [];
        const applied = await applyActions(ctx, foldHistory(records));
        added += applied.added;
        deleted += applied.deleted;
        const checkpoint = maxRecordId(records);
        if (checkpoint) {
          await sql`update gmail_accounts set history_id = greatest(history_id, ${checkpoint}::bigint) where id = ${accountId}`;
        }
        if (!page.nextPageToken) {
          const summary = summarizeFailures(failures);
          const latest = /^\d+$/.test(String(page.historyId ?? "")) ? String(page.historyId) : null;
          await sql`
            update gmail_accounts
               set history_id = greatest(history_id, ${latest}::bigint),
                   last_synced_at = now(),
                   last_error = ${summary},
                   last_error_at = ${summary ? new Date() : null}
             where id = ${accountId}
          `;
          finished = true;
          break;
        }
        pageToken = page.nextPageToken;
        await extendLease(accountId, "sync", LEASE_SECONDS);
        if (Date.now() >= options.deadline) break;
      }

      if (!finished) {
        moreToDo = true;
        break;
      }
      if (await releaseSyncLeaseIfIdle(accountId)) {
        held = false;
        break;
      }
      // A notification arrived during this pass: go again while time remains.
      if (Date.now() >= options.deadline) break;
      await extendLease(accountId, "sync", LEASE_SECONDS);
    }
    const summary = summarizeFailures(failures);
    result = { status: "ok", added, deleted, ...(summary ? { error: summary } : {}) };
  } catch (error) {
    if (error instanceof HistoryExpiredError) {
      try {
        await recoverExpiredHistory(accountId, client);
        result = { status: "recovered", added, deleted };
      } catch (recoveryError) {
        if (!(recoveryError instanceof AccountAuthError)) {
          await recordAccountError(accountId, recoveryError).catch(() => undefined);
        }
        result = { status: "error", added, deleted, error: describeSyncError(recoveryError) };
      }
    } else if (error instanceof AccountAuthError) {
      result = { status: "error", added, deleted, error: error.message };
    } else {
      await recordAccountError(accountId, error).catch(() => undefined);
      result = { status: "error", added, deleted, error: describeSyncError(error) };
    }
  } finally {
    if (held) await releaseLease(accountId, "sync").catch(() => undefined);
  }

  if (result.status === "recovered") {
    await triggerAccountJob(accountId, "backfill", { hop: hop + 1, fetchImpl: options.fetchImpl });
  } else if (result.status === "ok" && hop < MAX_CHAIN_HOPS) {
    const [row] = await sql<{ syncRequested: boolean }[]>`select sync_requested from gmail_accounts where id = ${accountId}`;
    if (moreToDo || row?.syncRequested) {
      await triggerAccountJob(accountId, "sync", { hop: hop + 1, fetchImpl: options.fetchImpl });
    }
  }
  return result;
}
