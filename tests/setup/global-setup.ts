import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Recreate the test database from supabase/migrations once per run.
 * Needs a local Postgres (see docs/DEVELOPMENT.md). Set SKIP_DB_TESTS=1 to
 * run only the pure unit tests without a database.
 */
export const READER = "crm_reader_test";
export const READER_PASSWORD = "crm-reader-test-password";

export default async function setup() {
  if (process.env.SKIP_DB_TESTS === "1") return;
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/crm_test");
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";

  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end();
  }

  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const dir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.unsafe(readFileSync(`${dir}${file}`, "utf8"));
    }
    // The SELECT-only role for Claude's query_database tool (roles are cluster-wide).
    const role = readFileSync(fileURLToPath(new URL("../../supabase/optional/readonly-role.sql", import.meta.url)), "utf8")
      .replace(/^create role crm_reader .*$/m, "")
      .replaceAll("crm_reader", READER);
    await db.unsafe(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${READER}') then
        create role ${READER} login password '${READER_PASSWORD}' noinherit;
      end if;
    end $$;`);
    await db.unsafe(role);
  } finally {
    await db.end();
  }
}
