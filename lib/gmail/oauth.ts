import "server-only";
import { env } from "@/lib/env";

/**
 * Google OAuth 2.0 (web server flow) for connecting Gmail accounts.
 * Docs: https://developers.google.com/identity/protocols/oauth2/web-server
 */

/**
 * gmail.modify = read, compose, send and change labels (archive, read/unread,
 * star…) — everything the CRM, the approval queue and the mail client need —
 * but never permanent deletion. Requested once so accounts never have to be
 * reconnected when a feature is added.
 */
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
] as const;

export const REQUIRED_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const REQUEST_TIMEOUT_MS = 30_000;
/** Used when Google omits expires_in (it never should). */
const DEFAULT_EXPIRES_IN_S = 3600;

const FULL_MAIL_SCOPE = "https://mail.google.com/";
const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

export class OAuthError extends Error {
  /** Google error code, e.g. "invalid_grant". */
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
  }
}

export interface OAuthTokens {
  accessToken: string;
  /** Only returned on the first consent (we always force prompt=consent). */
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  idToken: string | null;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  id_token?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/** `${env.appUrl}/api/google/callback` */
export function redirectUri(): string {
  return `${env.appUrl}/api/google/callback`;
}

/**
 * Authorization URL: response_type=code, access_type=offline,
 * prompt="consent select_account" (always returns a refresh token and lets the
 * owner pick which Google account to connect), include_granted_scopes=true,
 * the given CSRF state and an optional login_hint.
 */
export function buildAuthUrl(params: { state: string; loginHint?: string }): string {
  const query = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: params.state,
  });
  const hint = params.loginHint?.trim();
  if (hint) query.set("login_hint", hint);
  return `${AUTH_ENDPOINT}?${query.toString()}`;
}

/** POST https://oauth2.googleapis.com/token (authorization_code). Throws OAuthError. */
export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch): Promise<OAuthTokens> {
  const data = await tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: redirectUri(),
    },
    fetchImpl,
  );
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    scopes: data.scopes ?? [],
    idToken: data.idToken,
  };
}

/**
 * POST https://oauth2.googleapis.com/token (refresh_token).
 * Throws OAuthError with code "invalid_grant" when the grant was revoked/expired.
 */
export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: Date; scopes: string[] | null }> {
  const data = await tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
    },
    fetchImpl,
  );
  return { accessToken: data.accessToken, expiresAt: data.expiresAt, scopes: data.scopes };
}

/** POST https://oauth2.googleapis.com/revoke — best effort, never throws. */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const response = await fetchImpl(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Drain the body so the connection can be reused; the result does not matter.
    await response.text().catch(() => undefined);
  } catch {
    // Best effort: an already-revoked or expired token is fine.
  }
}

/** True when the granted scopes include everything sync needs (gmail.readonly). */
export function hasRequiredScopes(scopes: readonly string[]): boolean {
  const granted = scopeSet(scopes);
  return granted.has(REQUIRED_SCOPE) || granted.has(MODIFY_SCOPE) || granted.has(FULL_MAIL_SCOPE);
}

/** True when drafts can be saved and sent (gmail.compose or broader). */
export function canCompose(scopes: readonly string[]): boolean {
  const granted = scopeSet(scopes);
  return granted.has(COMPOSE_SCOPE) || granted.has(MODIFY_SCOPE) || granted.has(FULL_MAIL_SCOPE);
}

/** True when labels can be changed (archive, read/unread, star, trash). */
export function canModify(scopes: readonly string[]): boolean {
  const granted = scopeSet(scopes);
  return granted.has(MODIFY_SCOPE) || granted.has(FULL_MAIL_SCOPE);
}

/** Decode (without verifying — it came straight from Google over TLS) an id_token's email claim. */
export function emailFromIdToken(idToken: string): string | null {
  try {
    const parts = idToken.split(".");
    if (parts.length < 2 || !parts[1]) return null;
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    const email = (payload as { email?: unknown }).email;
    if (typeof email !== "string") return null;
    const normalized = email.trim().toLowerCase();
    return normalized.includes("@") ? normalized : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------ */

function scopeSet(scopes: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const scope of scopes) {
    for (const part of String(scope).split(/\s+/)) if (part) set.add(part);
  }
  return set;
}

function parseScopes(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  return value.split(/\s+/).filter(Boolean);
}

async function tokenRequest(
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[] | null;
  idToken: string | null;
}> {
  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OAuthError("network_error", `Could not reach Google's token endpoint: ${message}`, 503);
  }

  let data: GoogleTokenResponse | null = null;
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === "object") data = parsed as GoogleTokenResponse;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const { code, message } = describeError(data, response.status);
    throw new OAuthError(code, message, response.status);
  }
  if (!data || typeof data.access_token !== "string" || data.access_token === "") {
    throw new OAuthError("invalid_response", "Google's token endpoint returned no access token", 502);
  }

  const expiresIn = Number(data.expires_in);
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN_S;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null,
    expiresAt: new Date(Date.now() + seconds * 1000),
    scopes: parseScopes(data.scope),
    idToken: typeof data.id_token === "string" && data.id_token ? data.id_token : null,
  };
}

function describeError(data: GoogleTokenResponse | null, status: number): { code: string; message: string } {
  const fallback = `Google token endpoint returned HTTP ${status}`;
  if (!data) return { code: `http_${status}`, message: fallback };
  // OAuth endpoints: {"error": "invalid_grant", "error_description": "..."}.
  if (typeof data.error === "string" && data.error) {
    const description = typeof data.error_description === "string" && data.error_description ? data.error_description : data.error;
    return { code: data.error, message: description };
  }
  // Some Google front ends answer with the JSON API error shape instead.
  if (data.error && typeof data.error === "object") {
    const inner = data.error as { status?: unknown; message?: unknown };
    return {
      code: typeof inner.status === "string" && inner.status ? inner.status : `http_${status}`,
      message: typeof inner.message === "string" && inner.message ? inner.message : fallback,
    };
  }
  return { code: `http_${status}`, message: fallback };
}
