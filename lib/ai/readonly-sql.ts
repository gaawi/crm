import "server-only";
import postgres from "postgres";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Read-only SQL for Claude's query_database tool.
 *
 * Defence in depth — any one of these stops writes:
 * 1. Extended query protocol (`simple: false`): exactly one statement per
 *    call, so "select 1; commit; delete …" is a syntax error.
 * 2. The statement is wrapped as a subquery (`select … from (<q>) limit 200`),
 *    so only a SELECT/WITH query can even parse.
 * 3. It runs in a READ ONLY transaction that is always rolled back, with a 5 s
 *    statement timeout.
 * 4. Functions that can leave state behind the transaction (set_config,
 *    advisory locks, sleeps, file/large-object access, dblink) are rejected.
 * 5. Optionally a separate low-privilege role (DATABASE_READONLY_URL, see
 *    docs/SETUP.md) with SELECT-only grants and no access to tokens.
 */

const FORBIDDEN = /\b(set_config|pg_advisory\w*|pg_sleep\w*|pg_read\w*|pg_ls\w*|pg_stat_file|pg_terminate_backend|pg_cancel_backend|lo_\w+|dblink\w*|copy|refresh_token_enc|access_token_enc|txid_current|pg_notify|nextval|setval)\b/i;

const MAX_ROWS = 200;

/** Force the extended protocol (one statement). Supported at runtime, missing from the type definitions. */
const EXTENDED = { simple: false } as unknown as postgres.UnsafeQueryOptions;

class Rollback extends Error {
  constructor(readonly rows: unknown[]) {
    super("rollback");
  }
}

let readonlyClient: postgres.Sql | undefined;
function client(): postgres.Sql {
  const url = env.databaseReadonlyUrl;
  if (!url) return sql as unknown as postgres.Sql;
  // No camelCase transform here: Claude sees the real column names.
  readonlyClient ??= postgres(url, { prepare: false, max: 2, idle_timeout: 20, onnotice: () => {} });
  return readonlyClient;
}

export async function runReadonlyQuery(input: string): Promise<{ rows: unknown[]; truncated: boolean }> {
  const query = input.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(query)) throw new Error("Only a single SELECT (or WITH … SELECT) query is allowed.");
  if (query.includes(";")) throw new Error("Only one statement is allowed.");
  if (FORBIDDEN.test(query)) throw new Error("That function or column is not available in read-only queries.");

  try {
    await client().begin("read only", async (tx) => {
      await tx.unsafe("set local statement_timeout = '5s'", [], EXTENDED);
      await tx.unsafe("set local idle_in_transaction_session_timeout = '10s'", [], EXTENDED);
      // ::text keeps JSON keys exactly as the query named them.
      const result = await tx.unsafe(
        `select coalesce(json_agg(q), '[]'::json)::text as rows_json
           from (select * from (${query}) as inner_query limit ${MAX_ROWS + 1}) as q`,
        [],
        EXTENDED,
      );
      const row = result[0] as { rowsJson?: string; rows_json?: string } | undefined;
      const rows = JSON.parse(row?.rowsJson ?? row?.rows_json ?? "[]") as unknown[];
      throw new Rollback(rows);
    });
  } catch (error) {
    if (error instanceof Rollback) {
      return { rows: error.rows.slice(0, MAX_ROWS), truncated: error.rows.length > MAX_ROWS };
    }
    throw error;
  }
  return { rows: [], truncated: false };
}
