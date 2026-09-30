import "server-only";
import { headers } from "next/headers";
import { sql } from "@/lib/db";

/** Failed sign-ins allowed per 15-minute window: per client IP and overall. */
const WINDOW_MINUTES = 15;
const PER_IP = 10;
const GLOBAL = 50;

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
}

/** True when sign-in is currently blocked for this client. */
export async function loginBlocked(): Promise<boolean> {
  const ip = await clientIp();
  const rows = await sql<{ bucket: string; failures: number }[]>`
    select bucket, failures from login_attempts
     where bucket = any(${[`ip:${ip}`, "global"]}::text[])
       and window_start > now() - make_interval(mins => ${WINDOW_MINUTES})
  `;
  return rows.some((r) => (r.bucket === "global" ? r.failures >= GLOBAL : r.failures >= PER_IP));
}

export async function recordLoginFailure(): Promise<void> {
  const ip = await clientIp();
  for (const bucket of [`ip:${ip}`, "global"]) {
    await sql`
      insert into login_attempts (bucket, failures, window_start) values (${bucket}, 1, now())
      on conflict (bucket) do update set
        failures = case when login_attempts.window_start > now() - make_interval(mins => ${WINDOW_MINUTES})
                        then login_attempts.failures + 1 else 1 end,
        window_start = case when login_attempts.window_start > now() - make_interval(mins => ${WINDOW_MINUTES})
                            then login_attempts.window_start else now() end
    `;
  }
}

export async function recordLoginSuccess(): Promise<void> {
  const ip = await clientIp();
  await sql`delete from login_attempts where bucket = ${`ip:${ip}`}`;
}
