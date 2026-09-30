import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { getOwnAddresses } from "@/lib/queries/stats";
import type { GmailClient } from "@/lib/gmail/client";
import type { OAuthTokens } from "@/lib/gmail/oauth";
import type { AccountStatus, BackfillStatus, GmailAccountView } from "@/lib/types";

/** Full row (server-only; includes encrypted secrets and cursors). */
export interface GmailAccountRecord {
  id: string;
  email: string;
  displayName: string | null;
  aliases: string[];
  status: AccountStatus;
  scopes: string[];
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
  /** int8 → string */
  historyId: string | null;
  lastSyncedAt: Date | null;
  syncLockedUntil: Date | null;
  syncRequested: boolean;
  watchExpiresAt: Date | null;
  backfillStatus: BackfillStatus;
  backfillQuery: string | null;
  backfillPageToken: string | null;
  backfillScanned: number;
  backfillImported: number;
  backfillEstimate: number | null;
  backfillStartedAt: Date | null;
  backfillCompletedAt: Date | null;
  backfillLockedUntil: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** For the Settings page: no secrets, plus message counts and derived flags. */
export async function listAccountViews(): Promise<GmailAccountView[]> {
  const pushConfigured = Boolean(env.pubsubTopic);
  return sql<GmailAccountView[]>`
    select a.id, a.email, a.display_name, a.status,
           a.backfill_status, a.backfill_imported, a.backfill_scanned, a.backfill_estimate,
           a.backfill_started_at, a.backfill_completed_at,
           (a.status = 'active'
             and a.backfill_status in ('pending', 'running', 'error')
             and (a.backfill_locked_until is null or a.backfill_locked_until < now())) as backfill_stalled,
           a.last_synced_at, a.watch_expires_at,
           (${pushConfigured} and a.status = 'active' and a.watch_expires_at > now()) as push_active,
           a.last_error, a.last_error_at,
           (select count(*)::int from messages m where m.account_id = a.id) as message_count,
           a.created_at
      from gmail_accounts a
     order by a.created_at
  `;
}

export async function listAccounts(options: { activeOnly?: boolean } = {}): Promise<GmailAccountRecord[]> {
  return sql<GmailAccountRecord[]>`
    select * from gmail_accounts
     where ${options.activeOnly ? sql`status = 'active'` : sql`true`}
     order by created_at
  `;
}

export async function getAccount(id: string): Promise<GmailAccountRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<GmailAccountRecord[]>`select * from gmail_accounts where id = ${id}`;
  return row ?? null;
}

export async function getAccountByEmail(email: string): Promise<GmailAccountRecord | null> {
  const [row] = await sql<GmailAccountRecord[]>`select * from gmail_accounts where email = ${email.trim().toLowerCase()}`;
  return row ?? null;
}

/**
 * Insert or update (by email) after a successful OAuth callback.
 * New account: history_id = profile historyId, backfill pending with
 * buildBackfillQuery(env.skipCategories, env.backfillQuery), estimate =
 * messagesTotal. Existing account (reconnect): tokens replaced (refresh token
 * kept if Google did not return one — never overwritten with null), scopes and
 * aliases updated, status → active, errors cleared; history_id is only set when
 * it was null (the old cursor is kept so the gap is caught up by incremental
 * sync / its 404 recovery); a backfill in 'error' goes back to 'pending'.
 */
export async function upsertAccountFromOAuth(params: {
  email: string;
  displayName: string | null;
  tokens: OAuthTokens;
  historyId: string;
  messagesTotal: number;
  aliases: string[];
}): Promise<{ account: GmailAccountRecord; created: boolean }> {
  void params;
  throw new Error("TODO");
}

/** Re-read users.settings.sendAs and store verified aliases (best effort). */
export async function refreshAliases(accountId: string): Promise<void> {
  void accountId;
  throw new Error("TODO");
}

/**
 * Own addresses must never be contacts: remove contact_emails rows whose
 * address is now a self address (getSelfEmails) from auto-created
 * (source = 'gmail') contacts, delete auto-created contacts left without any
 * address, and refresh stats. Returns the number of addresses removed.
 */
export async function reconcileSelfContacts(): Promise<number> {
  throw new Error("TODO");
}

/**
 * Valid access token for the account: cached (encrypted) token if it expires
 * in > 60 s, otherwise refresh and cache. On invalid_grant: status →
 * reauth_required, last_error set, throws AccountAuthError.
 */
export async function getAccessToken(accountId: string, forceRefresh = false): Promise<string> {
  void accountId;
  void forceRefresh;
  throw new Error("TODO");
}

export class AccountAuthError extends Error {
  readonly accountId: string;
  constructor(accountId: string, message: string) {
    super(message);
    this.name = "AccountAuthError";
    this.accountId = accountId;
  }
}

/** GmailClient bound to getAccessToken(accountId). */
export function gmailClientFor(accountId: string, fetchImpl?: typeof fetch): GmailClient {
  void accountId;
  void fetchImpl;
  throw new Error("TODO");
}

/** Addresses that are "me": every account email + aliases + env.ownEmails, lower-cased. */
export async function getSelfEmails(): Promise<Set<string>> {
  return getOwnAddresses();
}

export async function recordAccountError(accountId: string, error: unknown): Promise<void> {
  void accountId;
  void error;
  throw new Error("TODO");
}

export async function clearAccountError(accountId: string): Promise<void> {
  void accountId;
  throw new Error("TODO");
}

/** Revoke token (best effort), stop watch (best effort), clear tokens, status → disconnected. Keeps messages. */
export async function disconnectAccount(accountId: string): Promise<void> {
  void accountId;
  throw new Error("TODO");
}

/** Delete the account and all its messages; refresh stats of affected contacts. */
export async function deleteAccount(accountId: string): Promise<void> {
  void accountId;
  throw new Error("TODO");
}
