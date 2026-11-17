"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { sendPush, vapidKeys } from "@/lib/push/web-push";

/** The key the browser needs to subscribe. */
export async function pushPublicKeyAction(): Promise<string> {
  await requireSession();
  return (await vapidKeys()).publicKey;
}

const subscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/** Save this device (from PushManager.subscribe), and send a first notification. */
export async function savePushSubscriptionAction(input: unknown, userAgent: string): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The browser returned an invalid subscription." };
  const { endpoint, keys } = parsed.data;
  await sql`
    insert into push_subscriptions (endpoint, p256dh, auth, user_agent)
    values (${endpoint}, ${keys.p256dh}, ${keys.auth}, ${userAgent.slice(0, 300)})
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, last_error = null`;
  return { ok: true };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<void> {
  await requireSession();
  await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
}

export async function testPushAction(): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const n = await sendPush({ title: "Vela", body: "Notifications are on. You'll hear about replies and mailings to approve.", url: "/", tag: "test" });
  if (n > 0) return { ok: true };
  const [row] = await sql<{ lastError: string | null }[]>`select last_error from push_subscriptions order by created_at desc limit 1`;
  return { ok: false, error: row?.lastError ?? "No device has notifications on yet." };
}
