import "server-only";
import { sql } from "@/lib/db";
import { listCampaignReplies } from "@/lib/queries/campaign-replies";
import { sendPush } from "@/lib/push/web-push";

/**
 * What the phone is told about, after each sync (new mail from Gmail's push,
 * the sync on visit, the daily cron):
 * - a campaign contact replied (a real email, not an automatic reply);
 * - a mass mailing is waiting for approval.
 * The icon's badge is the number of both. app_settings 'push_state' keeps
 * what was already notified, so nothing is sent twice.
 */
interface PushState {
  /** Replies newer than this are new (ISO). */
  repliesSince: string;
  /** Mailings already announced. */
  mailings: string[];
}

export async function notifyNew(): Promise<number> {
  const [subs] = await sql<{ n: number }[]>`select count(*)::int as n from push_subscriptions`;
  if (!subs?.n) return 0;

  const [row] = await sql<{ value: PushState }[]>`select value from app_settings where key = 'push_state'`;
  const now = new Date().toISOString();
  // First run: start from now (no burst of old replies).
  const state: PushState = row?.value ?? { repliesSince: now, mailings: [] };

  const [replies, waiting] = await Promise.all([
    listCampaignReplies(40),
    sql<{ id: string; name: string; n: number }[]>`
      select c.id, c.name, count(d.id)::int as n
        from email_campaigns c join email_drafts d on d.campaign_id = c.id and d.status in ('proposed', 'failed')
       where c.status = 'draft'
       group by c.id, c.name`,
  ]);
  const badge = replies.length + waiting.length;
  const fresh = replies.filter((r) => r.sentAt > state.repliesSince);
  const newMailings = waiting.filter((m) => !state.mailings.includes(m.id));

  // Claim first, so two syncs at once don't both notify.
  const next: PushState = {
    repliesSince: fresh.length ? fresh.reduce((a, r) => (r.sentAt > a ? r.sentAt : a), state.repliesSince) : state.repliesSince,
    mailings: [...new Set([...state.mailings.filter((id) => waiting.some((m) => m.id === id)), ...newMailings.map((m) => m.id)])],
  };
  const claimed = await sql`
    insert into app_settings (key, value, updated_at) values ('push_state', ${sql.json(next as never)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
     where app_settings.value = ${row ? sql.json(row.value as never) : null}::jsonb`;
  if (!claimed.count || !row) return 0;

  let sent = 0;
  if (fresh.length > 3) {
    sent += await sendPush({
      title: `${fresh.length} new replies`,
      body: fresh.map((r) => r.contactName).join(", "),
      url: "/",
      badge,
      tag: "replies",
    });
  } else {
    for (const r of fresh) {
      sent += await sendPush({
        title: `${r.contactName} replied${r.organizationName && r.organizationName !== r.contactName ? ` · ${r.organizationName}` : ""}`,
        body: r.excerpt.replace(/\s+/g, " ").slice(0, 180) || r.subject || "",
        url: `/mail/t/${r.accountId}/${encodeURIComponent(r.threadId)}`,
        badge,
        tag: `reply-${r.contactId}`,
      });
    }
  }
  for (const m of newMailings) {
    sent += await sendPush({
      title: "Mass mailing waiting for your approval",
      body: `${m.name} · ${m.n} emails`,
      url: `/approvals/mailings/${m.id}`,
      badge,
      tag: `mailing-${m.id}`,
    });
  }
  return sent;
}

/** Never throws: notifications must not break a sync. */
export async function notifyNewSafely(): Promise<void> {
  try {
    await notifyNew();
  } catch (error) {
    console.warn("notifyNew failed:", error instanceof Error ? error.message : error);
  }
}
