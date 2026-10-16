import { assistantApiGuard } from "@/lib/assistant/auth";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Read-only health of the mail import: per connected mailbox, its import
 * state and query, how many emails are stored and how far back they go
 * (per year), and the database size against its limit. No email content.
 * Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET /api/assistant-agent/diagnostics
 */

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
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
  return Response.json(
    {
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
