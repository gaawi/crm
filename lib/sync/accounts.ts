import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getOwnAddresses } from "@/lib/queries/stats";
import { GmailClient, type GmailClientOptions } from "@/lib/gmail/client";
import { OAuthError, refreshAccessToken, revokeToken, type OAuthTokens } from "@/lib/gmail/oauth";
import { buildBackfillQuery } from "@/lib/gmail/parse";
import type { GmailSendAs } from "@/lib/gmail/types";
import { describeSyncError } from "@/lib/sync/errors";
import { stopWatch } from "@/lib/sync/watch";
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

/** Current database size in MB (Settings page and the import's size guard). */
export async function databaseSizeMb(): Promise<number> {
  const [row] = await sql<{ mb: number }[]>`
    select round(pg_database_size(current_database()) / 1048576.0)::int as mb
  `;
  return row?.mb ?? 0;
}

/* ------------------------------------------------------------------------ */
/* OAuth connect / reconnect                                                */
/* ------------------------------------------------------------------------ */

/**
 * Send-as addresses worth treating as "me": verified (or primary) ones,
 * lower-cased, without the account address itself.
 */
export function verifiedAliases(sendAs: readonly GmailSendAs[], accountEmail: string): string[] {
  const own = accountEmail.trim().toLowerCase();
  const out = new Set<string>();
  for (const entry of sendAs ?? []) {
    const email = typeof entry?.sendAsEmail === "string" ? entry.sendAsEmail.trim().toLowerCase() : "";
    if (!email || !email.includes("@") || /\s/.test(email) || email === own) continue;
    if (entry.verificationStatus === "accepted" || entry.isPrimary) out.add(email);
  }
  return [...out].sort();
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
  const email = params.email.trim().toLowerCase();
  const aliases = [...new Set(params.aliases.map((a) => a.trim().toLowerCase()).filter((a) => a.includes("@") && a !== email))];
  const scopes = [...new Set(params.tokens.scopes.flatMap((s) => String(s).split(/\s+/)).filter(Boolean))];
  const refreshTokenEnc = params.tokens.refreshToken ? encryptSecret(params.tokens.refreshToken) : null;
  const accessTokenEnc = encryptSecret(params.tokens.accessToken);
  const displayName = params.displayName?.trim() || null;
  const estimate = Number.isFinite(params.messagesTotal) && params.messagesTotal >= 0 ? Math.floor(params.messagesTotal) : null;
  const historyId = /^\d+$/.test(String(params.historyId ?? "")) ? String(params.historyId) : null;

  const [row] = await sql<(GmailAccountRecord & { created: boolean })[]>`
    insert into gmail_accounts (
      email, display_name, aliases, status, scopes,
      refresh_token_enc, access_token_enc, access_token_expires_at,
      history_id, backfill_status, backfill_query, backfill_estimate
    ) values (
      ${email}, ${displayName}, ${aliases}::text[], 'active', ${scopes}::text[],
      ${refreshTokenEnc}, ${accessTokenEnc}, ${params.tokens.expiresAt},
      ${historyId}::bigint, 'pending', ${buildBackfillQuery(env.skipCategories, env.backfillQuery)}, ${estimate}
    )
    on conflict (email) do update set
      display_name            = coalesce(excluded.display_name, gmail_accounts.display_name),
      aliases                 = case when cardinality(excluded.aliases) > 0 then excluded.aliases
                                     else gmail_accounts.aliases end,
      scopes                  = case when cardinality(excluded.scopes) > 0 then excluded.scopes
                                     else gmail_accounts.scopes end,
      refresh_token_enc       = coalesce(excluded.refresh_token_enc, gmail_accounts.refresh_token_enc),
      access_token_enc        = excluded.access_token_enc,
      access_token_expires_at = excluded.access_token_expires_at,
      status                  = 'active',
      last_error              = null,
      last_error_at           = null,
      history_id              = coalesce(gmail_accounts.history_id, excluded.history_id),
      backfill_status         = case when gmail_accounts.backfill_status = 'error' then 'pending'
                                     else gmail_accounts.backfill_status end,
      backfill_estimate       = case when gmail_accounts.backfill_status = 'done' then gmail_accounts.backfill_estimate
                                     else coalesce(excluded.backfill_estimate, gmail_accounts.backfill_estimate) end
    returning *, (xmax = 0) as created
  `;
  const { created, ...account } = row;
  return { account: account as GmailAccountRecord, created };
}

/** Re-read users.settings.sendAs and store verified aliases (best effort, never throws). */
export async function refreshAliases(accountId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  try {
    const account = await getAccount(accountId);
    if (!account || account.status !== "active") return;
    const aliases = verifiedAliases(await gmailClientFor(accountId, options.fetchImpl).listSendAs(), account.email);
    await sql`
      update gmail_accounts set aliases = ${aliases}::text[]
       where id = ${accountId} and aliases is distinct from ${aliases}::text[]
    `;
  } catch (error) {
    if (!(error instanceof AccountAuthError)) console.warn(`refreshAliases(${accountId}) failed:`, describeSyncError(error));
  }
}

/**
 * Own addresses must never be contacts: delete contact_emails rows whose
 * address is a self address (getSelfEmails, from any contact), delete
 * auto-created (source = 'gmail') contacts left without any address and
 * without opportunities, give contacts that lost their primary address a new
 * one, and refresh stats. Returns the number of addresses removed.
 */
export async function reconcileSelfContacts(): Promise<number> {
  const self = [...(await getSelfEmails())];
  if (self.length === 0) return 0;
  return sql.begin(async (tx) => {
    const removed = await tx<{ contactId: string }[]>`
      delete from contact_emails where email = any(${self}::text[]) returning contact_id
    `;
    if (removed.length === 0) return 0;
    const ids = [...new Set(removed.map((r) => r.contactId))];
    await tx`
      delete from contacts c
       where c.id = any(${ids}::uuid[])
         and c.source = 'gmail'
         and not exists (select 1 from contact_emails ce where ce.contact_id = c.id)
         and not exists (select 1 from opportunities o where o.contact_id = c.id)
    `;
    await tx`
      update contact_emails ce set is_primary = true
       where ce.email in (
               select distinct on (x.contact_id) x.email
                 from contact_emails x
                where x.contact_id = any(${ids}::uuid[])
                order by x.contact_id, x.created_at, x.email)
         and not exists (select 1 from contact_emails p where p.contact_id = ce.contact_id and p.is_primary)
    `;
    await tx`select refresh_contact_stats(array(select id from contacts where id = any(${ids}::uuid[])))`;
    return removed.length;
  });
}

/* ------------------------------------------------------------------------ */
/* Tokens and clients                                                       */
/* ------------------------------------------------------------------------ */

/** A cached access token is used only while it has more than this left. */
const TOKEN_MIN_REMAINING_MS = 60_000;

export class AccountAuthError extends Error {
  readonly accountId: string;
  constructor(accountId: string, message: string) {
    super(message);
    this.name = "AccountAuthError";
    this.accountId = accountId;
  }
}

async function markReauthRequired(accountId: string, message: string): Promise<void> {
  await sql`
    update gmail_accounts
       set status = 'reauth_required', access_token_enc = null, access_token_expires_at = null,
           last_error = ${message}, last_error_at = now()
     where id = ${accountId} and status <> 'disconnected'
  `;
}

async function loadAccessToken(
  accountId: string,
  forceRefresh: boolean,
  fetchImpl: typeof fetch | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const [account] = await sql<
    Pick<GmailAccountRecord, "email" | "status" | "refreshTokenEnc" | "accessTokenEnc" | "accessTokenExpiresAt">[]
  >`
    select email, status, refresh_token_enc, access_token_enc, access_token_expires_at
      from gmail_accounts where id = ${accountId}
  `;
  if (!account) throw new AccountAuthError(accountId, "Gmail account not found");
  if (account.status !== "active") {
    throw new AccountAuthError(accountId, `Reconnect ${account.email} in Settings to resume sync`);
  }

  if (
    !forceRefresh &&
    account.accessTokenEnc &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() - Date.now() > TOKEN_MIN_REMAINING_MS
  ) {
    try {
      return { token: decryptSecret(account.accessTokenEnc), expiresAt: account.accessTokenExpiresAt };
    } catch {
      // Unreadable cache (key rotated): refresh below.
    }
  }

  let refreshToken: string | null = null;
  try {
    refreshToken = account.refreshTokenEnc ? decryptSecret(account.refreshTokenEnc) : null;
  } catch {
    refreshToken = null;
  }
  if (!refreshToken) {
    const message = `No usable Google refresh token for ${account.email}: reconnect it in Settings`;
    await markReauthRequired(accountId, message);
    throw new AccountAuthError(accountId, message);
  }

  try {
    const result = await refreshAccessToken(refreshToken, fetchImpl);
    await sql`
      update gmail_accounts
         set access_token_enc = ${encryptSecret(result.accessToken)},
             access_token_expires_at = ${result.expiresAt},
             scopes = case when ${result.scopes !== null && result.scopes.length > 0}::boolean
                           then ${result.scopes ?? []}::text[] else scopes end
       where id = ${accountId}
    `;
    return { token: result.accessToken, expiresAt: result.expiresAt };
  } catch (error) {
    if (error instanceof OAuthError && error.code === "invalid_grant") {
      const message = `Google access for ${account.email} was revoked or has expired: reconnect it in Settings`;
      await markReauthRequired(accountId, message);
      throw new AccountAuthError(accountId, message);
    }
    throw error;
  }
}

/**
 * Valid access token for the account: cached (encrypted) token if it expires
 * in > 60 s, otherwise refresh and cache. On invalid_grant: status →
 * reauth_required, last_error set, throws AccountAuthError.
 * `fetchImpl` is used for the token endpoint (tests).
 */
export async function getAccessToken(accountId: string, forceRefresh = false, fetchImpl?: typeof fetch): Promise<string> {
  return (await loadAccessToken(accountId, forceRefresh, fetchImpl)).token;
}

/** Pacing / retry knobs of GmailClient that callers (tests) may override. */
export type GmailClientTuning = Pick<GmailClientOptions, "maxRetries" | "retryBaseMs" | "maxRequestsPerSecond">;

let clientDefaults: GmailClientTuning = {};

/**
 * Test hook: defaults for every client built by gmailClientFor /
 * gmailClientForToken, e.g. `{ maxRequestsPerSecond: Infinity, retryBaseMs: 0 }`
 * so tests do not wait for pacing or backoff. Pass `{}` to restore production
 * defaults. Production code never calls this.
 */
export function setGmailClientDefaults(options: GmailClientTuning): void {
  clientDefaults = { ...options };
}

/**
 * GmailClient bound to getAccessToken(accountId). The token is also memoized
 * in the client (one DB read per token lifetime, concurrent refreshes shared).
 */
export function gmailClientFor(accountId: string, fetchImpl?: typeof fetch, options: GmailClientTuning = {}): GmailClient {
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: { promise: Promise<string>; forced: boolean } | null = null;

  const getToken = (forceRefresh = false): Promise<string> => {
    if (!forceRefresh && cached && cached.expiresAt - Date.now() > TOKEN_MIN_REMAINING_MS) {
      return Promise.resolve(cached.token);
    }
    if (pending && (pending.forced || !forceRefresh)) return pending.promise;
    const promise = loadAccessToken(accountId, forceRefresh, fetchImpl)
      .then((result) => {
        cached = { token: result.token, expiresAt: result.expiresAt.getTime() };
        return result.token;
      })
      .finally(() => {
        if (pending?.promise === promise) pending = null;
      });
    pending = { promise, forced: forceRefresh };
    return promise;
  };

  return new GmailClient({ ...clientDefaults, ...options, getAccessToken: getToken, fetch: fetchImpl });
}

/** Client for a token that is not stored yet (the OAuth callback). */
export function gmailClientForToken(accessToken: string, fetchImpl?: typeof fetch): GmailClient {
  return new GmailClient({ ...clientDefaults, getAccessToken: async () => accessToken, fetch: fetchImpl });
}

/** Addresses that are "me": every account email + aliases + env.ownEmails, lower-cased. */
export async function getSelfEmails(): Promise<Set<string>> {
  return getOwnAddresses();
}

/* ------------------------------------------------------------------------ */
/* Errors and lifecycle                                                     */
/* ------------------------------------------------------------------------ */

/** Store a short human-readable error (≤ 500 chars) on the account. */
export async function recordAccountError(accountId: string, error: unknown): Promise<void> {
  const message = describeSyncError(error);
  await sql`update gmail_accounts set last_error = ${message}, last_error_at = now() where id = ${accountId}`;
}

export async function clearAccountError(accountId: string): Promise<void> {
  await sql`
    update gmail_accounts set last_error = null, last_error_at = null
     where id = ${accountId} and (last_error is not null or last_error_at is not null)
  `;
}

async function revokeStoredToken(account: GmailAccountRecord, fetchImpl?: typeof fetch): Promise<void> {
  const encrypted = account.refreshTokenEnc ?? account.accessTokenEnc;
  if (!encrypted) return;
  try {
    await revokeToken(decryptSecret(encrypted), fetchImpl);
  } catch {
    // Best effort.
  }
}

/** Stop watch (best effort), revoke token (best effort), clear tokens, status → disconnected. Keeps messages. */
export async function disconnectAccount(accountId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  const account = await getAccount(accountId);
  if (!account) return;
  // Stop first: users.stop needs a valid token, which revoking destroys.
  await stopWatch(accountId, options).catch(() => undefined);
  await revokeStoredToken(account, options.fetchImpl);
  await sql`
    update gmail_accounts
       set status = 'disconnected', refresh_token_enc = null, access_token_enc = null,
           access_token_expires_at = null, watch_expires_at = null, sync_requested = false,
           last_error = null, last_error_at = null
     where id = ${accountId}
  `;
}

/** Delete the account and all its messages; refresh stats of affected contacts. */
export async function deleteAccount(accountId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  const account = await getAccount(accountId);
  if (!account) return;
  if (account.status === "active") await stopWatch(accountId, options).catch(() => undefined);
  await revokeStoredToken(account, options.fetchImpl);
  await sql.begin(async (tx) => {
    const affected = await tx<{ contactId: string }[]>`
      select distinct ce.contact_id
        from messages m
        join message_participants mp on mp.message_id = m.id
        join contact_emails ce on ce.email = mp.email
       where m.account_id = ${accountId}
    `;
    await tx`delete from gmail_accounts where id = ${accountId}`;
    if (affected.length > 0) {
      await tx`select refresh_contact_stats(${affected.map((r) => r.contactId)}::uuid[])`;
    }
  });
}
