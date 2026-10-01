import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { runReadonlyQuery } from "@/lib/ai/readonly-sql";
import { useTestDatabase } from "../setup/db";

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("read-only SQL tool", () => {
  useTestDatabase();

  it("returns rows with their real column names", async () => {
    const { rows } = await runReadonlyQuery("select name, sort_order from projects order by sort_order limit 2");
    expect(rows).toEqual([
      { name: "CreArtBox", sort_order: 1 },
      { name: "ADAR", sort_order: 2 },
    ]);
  });

  it.each([
    "select 1; commit; delete from projects",
    "delete from projects",
    "with x as (delete from projects returning *) select * from x",
    "select set_config('default_transaction_read_only', 'off', false)",
    "select pg_advisory_lock(1)",
    "select pg_sleep(10)",
    "select refresh_token_enc from gmail_accounts",
    "select * from gmail_accounts",
    "select to_jsonb(g) from gmail_accounts g",
    "select pg_try_advisory_lock(4242)",
    `select U&"pg\\005fadvisory\\005flock"(4343)`,
    "update projects set name = 'x'",
  ])("refuses %s", async (query) => {
    await expect(runReadonlyQuery(query)).rejects.toThrow();
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from projects`;
    expect(count).toBe(8);
  });

  it("never leaves an advisory lock behind", async () => {
    const [{ locks }] = await sql<{ locks: number }[]>`select count(*)::int as locks from pg_locks where locktype = 'advisory'`;
    expect(locks).toBe(0);
  });

  it("reads token-free account columns", async () => {
    await sql`insert into gmail_accounts (email, refresh_token_enc) values ('me@own.test', 'SECRET')`;
    const { rows } = await runReadonlyQuery("select email from gmail_accounts");
    expect(rows).toEqual([{ email: "me@own.test" }]);
  });

  it("caps rows", async () => {
    const { rows, truncated } = await runReadonlyQuery("select g from generate_series(1, 500) g");
    expect(rows).toHaveLength(200);
    expect(truncated).toBe(true);
  });
});
