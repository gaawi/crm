import { NextResponse } from "next/server";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { buildAuthUrl } from "@/lib/gmail/oauth";
import { hasSession, OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH, OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/sync/http";

/**
 * GET /api/google/connect[?login_hint=…] → Google's consent screen.
 * A one-time CSRF state goes in an httpOnly cookie scoped to /api/google.
 */
export async function GET(request: Request) {
  if (!(await hasSession(request))) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/settings");
    return NextResponse.redirect(login);
  }

  const state = randomToken(32);
  const loginHint = new URL(request.url).searchParams.get("login_hint")?.trim() || undefined;
  const response = NextResponse.redirect(buildAuthUrl({ state, loginHint }));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
