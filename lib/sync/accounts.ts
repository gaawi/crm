import "server-only";
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
  throw new Error("TODO");
}

export async function listAccounts(options: { activeOnly?: boolean } = {}): Promise<GmailAccountRecord[]> {
  void options;
  throw new Error("TODO");
}

export async function getAccount(id: string): Promise<GmailAccountRecord | null> {
  void id;
  throw new Error("TODO");
}

export async function getAccountByEmail(email: string): Promise<GmailAccountRecord | null> {
  void email;
  throw new Error("TODO");
}

/**
 * Insert or update (by email) after a successful OAuth callback.
 * New account: history_id = profile historyId, backfill pending with the
 * current backfill query. Existing account: tokens replaced (refresh token kept
 * if Google did not return a new one), status → active, errors cleared; sync
 * cursors are kept.
 */
export async function upsertAccountFromOAuth(params: {
  email: string;
  displayName: string | null;
  tokens: OAuthTokens;
  historyId: string;
  messagesTotal: number;
  aliases: string[];
}): Promise<GmailAccountRecord> {
  void params;
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

/** Addresses that are "me": every account email + aliases, lower-cased. */
export async function getSelfEmails(): Promise<Set<string>> {
  throw new Error("TODO");
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
