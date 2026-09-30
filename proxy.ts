import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Optimistic auth gate. Every page, action and route handler re-checks auth
 * itself; this only keeps signed-out visitors away from the UI.
 *
 * Machine endpoints authenticate on their own and are excluded:
 *   /api/gmail/push (Pub/Sub token), /api/cron/* and /api/sync/* (CRON_SECRET
 *   or session), /api/mcp (MCP_API_KEY).
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/gmail/push",
  "/api/cron/",
  "/api/sync/",
  "/api/mcp",
  // App icons and manifest (Add to Home Screen).
  "/manifest.webmanifest",
  "/apple-icon",
  "/pwa-icon/",
];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
