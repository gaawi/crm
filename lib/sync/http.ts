import "server-only";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Request helpers for the sync route handlers. They read the request itself
 * (not next/headers), so handlers work with plain `Request` objects in tests.
 */

/** CSRF state of the Google OAuth flow (httpOnly, path /api/google, 10 minutes). */
export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_STATE_COOKIE_PATH = "/api/google";
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

/** Value of one cookie from the Cookie header, or null. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/** True when the request carries a valid session cookie. */
export async function hasSession(request: Request): Promise<boolean> {
  return verifySessionToken(readCookie(request, SESSION_COOKIE));
}
