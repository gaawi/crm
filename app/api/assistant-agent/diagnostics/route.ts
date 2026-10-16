import { loadReviewInbox } from "@/components/assistant/review-inbox";
import { loadPendingApprovals } from "@/lib/approvals/pending";
import postgres from "postgres";
import { assistantApiGuard } from "@/lib/assistant/auth";
import { todayIn } from "@/lib/dates";
import { getFollowUps, getUpcomingFollowUps } from "@/lib/queries/followups";
import { recentActivity } from "@/lib/queries/messages";
import { getOverviewCounts } from "@/lib/queries/stats";
import { contactCampaigns, listCampaignRefs } from "@/lib/queries/today";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { linkOrganizations } from "@/lib/queries/organizations";
import { startOlderHistoryImport } from "@/lib/sync/backfill";
import { triggerAccountJob } from "@/lib/sync/trigger";

/**
 * Read-only health of the mail import: per connected mailbox, its import
 * state and query, how many emails are stored and how far back they go
 * (per year), and the database size against its limit. No email content.
 * Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET /api/assistant-agent/diagnostics
 * POST /api/assistant-agent/diagnostics {"action":"link-organizations"} fills
 *   organization domains and joins unaffiliated contacts to their organization
 *   (the daily sync does it too). Only adds links, never removes.
 * POST {"action":"import-older-history","email":"…"} starts the lean import of
 *   that mailbox's mail older than its oldest stored email (read-only on Gmail).
 */

/** ?timings=today: how long each part of the Today page takes on the real data (the same calls the page makes). */
async function todayTimings() {
  const today = todayIn(env.timezone);
  const timed = async <T>(name: string, run: () => Promise<T>) => {
    const start = performance.now();
    const value = await run();
    return { name, ms: Math.round(performance.now() - start), value };
  };
  const total = performance.now();
  const parts = await Promise.all([
    timed("followUps", () => getFollowUps({ today, limit: 30 })),
    timed("upcoming", () => getUpcomingFollowUps({ today, days: 7, limit: 8 })),
    timed("recentActivity", () => recentActivity(12)),
    timed("overviewCounts", () => getOverviewCounts()),
    timed("reviewInbox", () => loadReviewInbox(today)),
    timed("campaignRefs", () => listCampaignRefs()),
    timed("pendingApprovals", () => loadPendingApprovals()),
  ]);
  const parallelMs = Math.round(performance.now() - total);
  const ids = [
    ...(parts[0].value as Awaited<ReturnType<typeof getFollowUps>>).due.map((c) => c.id),
    ...(parts[1].value as Awaited<ReturnType<typeof getUpcomingFollowUps>>).map((c) => c.id),
  ];
  const memberships = await timed("contactCampaigns", () => contactCampaigns(ids));
  // Each part alone, one after the other (no contention).
  const alone = [];
  for (const [name, run] of [
    ["followUps", () => getFollowUps({ today, limit: 30 })],
    ["upcoming", () => getUpcomingFollowUps({ today, days: 7, limit: 8 })],
    ["recentActivity", () => recentActivity(12)],
    ["overviewCounts", () => getOverviewCounts()],
    ["reviewInbox", () => loadReviewInbox(today)],
    ["campaignRefs", () => listCampaignRefs()],
    ["pendingApprovals", () => loadPendingApprovals()],
  ] as const) {
    const t = await timed(name, run as () => Promise<unknown>);
    alone.push({ name, ms: t.ms });
  }
  return { parallelMs, parallel: parts.map((p) => ({ name: p.name, ms: p.ms })), contactCampaignsMs: memberships.ms, alone };
}

/** ?timings=connect: how long opening N fresh connections in parallel takes (N = 1, 4, 12), each on its own client. */
async function connectTimings() {
  const out: { connections: number; ms: number }[] = [];
  for (const n of [1, 4, 12]) {
    const client = postgres(env.databaseUrl, { prepare: false, max: n, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });
    const start = performance.now();
    await Promise.all(Array.from({ length: n }, () => client`select pg_sleep(0.05)`));
    out.push({ connections: n, ms: Math.round(performance.now() - start) });
    await client.end({ timeout: 2 });
  }
  return out;
}

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  if (new URL(request.url).searchParams.get("timings") === "connect")
    return Response.json(await connectTimings(), { headers: { "Cache-Control": "no-store" } });
  if (new URL(request.url).searchParams.get("timings") === "today")
    return Response.json(await todayTimings(), { headers: { "Cache-Control": "no-store" } });
  const accounts = await sql`
    select a.email, a.status, a.monitor_only, a.backfill_status, a.backfill_query, a.backfill_imported, a.backfill_scanned,
           a.backfill_estimate, a.backfill_started_at, a.backfill_completed_at, a.backfill_page_token is not null as has_page_token,
           a.last_synced_at, a.last_error, a.last_error_at,
           (select count(*)::int from messages m where m.account_id = a.id) as messages,
           (select min(m.sent_at) from messages m where m.account_id = a.id) as oldest,
           (select max(m.sent_at) from messages m where m.account_id = a.id) as newest,
           (select coalesce(json_object_agg(y, n order by y), '{}') from (
              select extract(year from m.sent_at)::int as y, count(*)::int as n from messages m where m.account_id = a.id group by 1) per) as per_year
      from gmail_accounts a
     order by a.email`;
  const [size] = await sql<{ mb: number }[]>`select (pg_database_size(current_database()) / 1048576)::int as mb`;
  const tables = await sql`
    select relname as table, (pg_total_relation_size(c.oid) / 1048576)::int as mb
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by pg_total_relation_size(c.oid) desc limit 8`;
  const [organizations] = await sql`
    select count(*)::int as total, count(*) filter (where cardinality(domains) > 0)::int as with_domains,
           (select count(*)::int from contacts where organization_id is null) as contacts_without_organization
      from organizations`;
  return Response.json(
    {
      organizations,
      databaseMb: size.mb,
      limitMb: env.dbSizeLimitMb,
      skipCategories: env.skipCategories,
      backfillQuery: env.backfillQuery ?? null,
      tables,
      accounts,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { action?: string; email?: string } | null;
  if (body?.action === "link-organizations") return Response.json(await linkOrganizations(), { headers: { "Cache-Control": "no-store" } });
  if (body?.action === "import-older-history" && body.email) {
    const [account] = await sql<{ id: string }[]>`select id from gmail_accounts where lower(email) = lower(${body.email}) and status = 'active'`;
    if (!account) return Response.json({ error: "No active mailbox with that address." }, { status: 404 });
    const started = await startOlderHistoryImport(account.id);
    const triggered = started ? await triggerAccountJob(account.id, "backfill") : false;
    return Response.json({ started, triggered });
  }
  return Response.json({ error: 'Pass {"action":"link-organizations"} or {"action":"import-older-history","email":"…"}.' }, { status: 400 });
}
