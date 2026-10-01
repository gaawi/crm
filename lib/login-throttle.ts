import "server-only";
import { cookies, headers } from "next/headers";
import { sql } from "@/lib/db";
import { DEVICE_COOKIE, verifyDeviceToken } from "@/lib/session";

/**
 * Sign-in attempts per 15-minute window: 10 per client IP and 50 overall.
 * A browser that signed in successfully before carries a device cookie and
 * is counted only against its own bucket, so a flood of wrong passwords from
 * elsewhere can never lock the owner out of their own devices.
 *
 * Every attempt is reserved atomically *before* the password is checked, so
 * concurrent requests cannot exceed the limits.
 */
const WINDOW_MINUTES = 15;
const PER_CLIENT = 10;
const GLOBAL = 50;

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
}

async function buckets(): Promise<{ client: string; global: boolean }> {
  const device = await verifyDeviceToken((await cookies()).get(DEVICE_COOKIE)?.value);
  if (device) return { client: `device:${device}`, global: false };
  return { client: `ip:${await clientIp()}`, global: true };
}

/** Count this attempt; false when it is over the limit (do not check the password then). */
export async function reserveLoginAttempt(): Promise<boolean> {
  const { client, global } = await buckets();
  const names = global ? [client, "global"] : [client];
  const rows = await sql<{ bucket: string; failures: number }[]>`
    insert into login_attempts (bucket, failures, window_start)
    select b, 1, now() from unnest(${names}::text[]) as b
    on conflict (bucket) do update set
      failures = case when login_attempts.window_start > now() - make_interval(mins => ${WINDOW_MINUTES})
                      then login_attempts.failures + 1 else 1 end,
      window_start = case when login_attempts.window_start > now() - make_interval(mins => ${WINDOW_MINUTES})
                          then login_attempts.window_start else now() end
    returning bucket, failures
  `;
  return rows.every((r) => r.failures <= (r.bucket === "global" ? GLOBAL : PER_CLIENT));
}

/** A correct password: forget this client's attempts and give the global bucket its slot back. */
export async function recordLoginSuccess(): Promise<void> {
  const { client, global } = await buckets();
  await sql`delete from login_attempts where bucket = ${client}`;
  if (global) await sql`update login_attempts set failures = greatest(failures - 1, 0) where bucket = 'global'`;
}
