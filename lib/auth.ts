import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "@/lib/session";

/** True when the request carries a valid session cookie (deduped per render). */
export const isAuthenticated = cache(async (): Promise<boolean> => {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
});

/** For pages and server actions: redirect to /login when not signed in. */
export async function requireSession(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** For route handlers: throws UnauthorizedError (map to 401). */
export async function assertSession(): Promise<void> {
  if (!(await isAuthenticated())) throw new UnauthorizedError();
}

/** `Authorization: Bearer <CRON_SECRET>` (Vercel Cron and internal self-requests). */
export function hasCronSecret(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  try {
    return safeEqual(match[1].trim(), env.cronSecret);
  } catch {
    return false;
  }
}

export function checkPassword(candidate: string): boolean {
  return safeEqual(candidate, env.appPassword);
}

export async function startSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
