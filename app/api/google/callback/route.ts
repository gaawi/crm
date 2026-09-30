import { after, NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { exchangeCode, hasRequiredScopes, type OAuthTokens } from "@/lib/gmail/oauth";
import type { GmailSendAs } from "@/lib/gmail/types";
import {
  gmailClientForToken,
  reconcileSelfContacts,
  recordAccountError,
  upsertAccountFromOAuth,
  verifiedAliases,
} from "@/lib/sync/accounts";
import { hasSession, OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH, readCookie } from "@/lib/sync/http";
import { runIncrementalSync } from "@/lib/sync/incremental";
import { deadlineFor, runAccountJob } from "@/lib/sync/runner";
import { ensureWatch } from "@/lib/sync/watch";

export const maxDuration = 300;

function settingsRedirect(query: Record<string, string>): NextResponse {
  const url = new URL("/settings", env.appUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  // The state is single-use.
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: OAUTH_STATE_COOKIE_PATH,
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** The "name" claim of Google's id_token (not verified: it came straight from Google over TLS). */
function nameFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const name = payload && typeof payload === "object" ? (payload as { name?: unknown }).name : null;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/google/callback?code=…&state=… (Google redirects here after consent).
 * Stores the account, then imports / catches up in after().
 */
export async function GET(request: Request) {
  const start = Date.now();
  if (!(await hasSession(request))) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/settings");
    return NextResponse.redirect(login);
  }

  const params = new URL(request.url).searchParams;
  const oauthError = params.get("error");
  if (oauthError) {
    const code = oauthError.replace(/[^a-z0-9_]/gi, "").slice(0, 64) || "oauth";
    return settingsRedirect({ error: code });
  }

  const state = params.get("state") ?? "";
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE) ?? "";
  if (!state || !expectedState || !safeEqual(state, expectedState)) return settingsRedirect({ error: "state" });

  const code = params.get("code");
  if (!code) return settingsRedirect({ error: "code" });

  let tokens: OAuthTokens;
  try {
    tokens = await exchangeCode(code);
  } catch (error) {
    console.error("OAuth code exchange failed", error);
    return settingsRedirect({ error: "token" });
  }
  // Not revoked: with include_granted_scopes that would also revoke an existing connection.
  if (!hasRequiredScopes(tokens.scopes)) return settingsRedirect({ error: "scopes" });

  const client = gmailClientForToken(tokens.accessToken);
  let profile;
  try {
    profile = await client.getProfile();
  } catch (error) {
    console.error("Gmail profile request failed", error);
    return settingsRedirect({ error: "profile" });
  }
  const email = String(profile.emailAddress ?? "").trim().toLowerCase();
  if (!email.includes("@")) return settingsRedirect({ error: "profile" });

  let sendAs: GmailSendAs[] = [];
  try {
    sendAs = await client.listSendAs();
  } catch {
    // Best effort: the daily cron refreshes aliases.
  }
  const primaryName = sendAs.find((s) => s.isPrimary || s.sendAsEmail?.toLowerCase() === email)?.displayName?.trim();

  const { account, created } = await upsertAccountFromOAuth({
    email,
    displayName: primaryName || nameFromIdToken(tokens.idToken),
    tokens,
    historyId: String(profile.historyId),
    messagesTotal: Number(profile.messagesTotal ?? 0),
    aliases: verifiedAliases(sendAs, email),
  });
  if (!account.refreshTokenEnc) {
    await recordAccountError(
      account.id,
      "Google did not return a refresh token: remove the CRM's access at myaccount.google.com/permissions, then connect again",
    );
  }
  try {
    // The new address (and its aliases) must not stay a contact. The daily cron repeats this.
    await reconcileSelfContacts();
  } catch (error) {
    console.error("reconcileSelfContacts failed", error);
  }

  const deadline = deadlineFor(maxDuration, start);
  after(async () => {
    try {
      await ensureWatch(account.id);
      if (created || account.backfillStatus !== "done") {
        // Import directly in this invocation, then chain (hop 1, 2, …).
        await runAccountJob(account.id, "backfill", { deadline, hop: 0 });
      } else {
        // Reconnect: catch up from the kept history cursor.
        await runIncrementalSync(account.id, { deadline });
      }
    } catch (error) {
      console.error(`Post-connect sync of ${email} failed`, error);
    }
  });

  return settingsRedirect({ connected: email });
}
