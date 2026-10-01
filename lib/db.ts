import "server-only";
import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * Shared postgres.js client.
 *
 * - Column names are converted to camelCase in results (`last_contacted_at` →
 *   `lastContactedAt`) and back to snake_case in `sql(object)` helpers.
 * - `date` columns stay 'YYYY-MM-DD' strings; `timestamptz` become Date.
 * - int8 / numeric come back as strings — cast counts with `::int` in SQL.
 * - Supabase's transaction pooler (port 6543): `prepare: false`. postgres.js
 *   pipelines queries onto busy connections once all `max` are in use, and
 *   the pooler can route parts of pipelined queries to different server
 *   connections, which then hang forever (waiting in "ClientRead"). So each
 *   instance may open enough client connections (cheap: the pooler admits
 *   200 and multiplexes them) that a page's parallel queries never pipeline.
 *   (The session pooler would allow pipelining but admits only ~15 clients.)
 */
function createClient() {
  return postgres(env.databaseUrl, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 20),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      date: {
        to: 1082,
        from: [1082],
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
    },
    transform: {
      ...postgres.camel,
      undefined: null,
    },
  });
}

type Sql = ReturnType<typeof createClient>;

const globalForDb = globalThis as unknown as { __crmSql?: Sql };

function client(): Sql {
  if (!globalForDb.__crmSql) globalForDb.__crmSql = createClient();
  return globalForDb.__crmSql;
}

/**
 * Lazily-connected client. Use as a tagged template: sql`select 1`, and
 * sql.begin(async (tx) => { ... }) for transactions.
 */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply(_target, _thisArg, args) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    const real = client() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export type { Sql };
type ClientTypes = Sql extends postgres.Sql<infer T> ? T : never;
/** Transaction handle passed to sql.begin callbacks. */
export type Tx = postgres.TransactionSql<ClientTypes>;

/** Close the pool (tests and scripts). */
export async function closeDb(): Promise<void> {
  if (globalForDb.__crmSql) {
    await globalForDb.__crmSql.end({ timeout: 5 });
    globalForDb.__crmSql = undefined;
  }
}
