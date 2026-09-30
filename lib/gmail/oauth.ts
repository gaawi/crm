import "server-only";

/**
 * Google OAuth 2.0 (web server flow) for connecting Gmail accounts.
 * Docs: https://developers.google.com/identity/protocols/oauth2/web-server
 */

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
] as const;

export const REQUIRED_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

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

/** `${env.appUrl}/api/google/callback` */
export function redirectUri(): string {
  throw new Error("TODO");
}

/**
 * Authorization URL: access_type=offline, prompt=consent (always returns a
 * refresh token), include_granted_scopes=true, the given CSRF state and an
 * optional login_hint.
 */
export function buildAuthUrl(params: { state: string; loginHint?: string }): string {
  void params;
  throw new Error("TODO");
}

/** POST https://oauth2.googleapis.com/token (authorization_code). Throws OAuthError. */
export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch): Promise<OAuthTokens> {
  void code;
  void fetchImpl;
  throw new Error("TODO");
}

/**
 * POST https://oauth2.googleapis.com/token (refresh_token).
 * Throws OAuthError with code "invalid_grant" when the grant was revoked/expired.
 */
export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: Date; scopes: string[] | null }> {
  void refreshToken;
  void fetchImpl;
  throw new Error("TODO");
}

/** POST https://oauth2.googleapis.com/revoke — best effort, never throws. */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  void token;
  void fetchImpl;
  throw new Error("TODO");
}

/** Decode (without verifying — it came straight from Google over TLS) an id_token's email claim. */
export function emailFromIdToken(idToken: string): string | null {
  void idToken;
  throw new Error("TODO");
}
