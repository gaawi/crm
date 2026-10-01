#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql in order, once each, tracking them in
 * public.schema_migrations. Usage: DATABASE_URL=postgres://... npm run db:migrate
 * (Supabase CLI users can run `supabase db push` instead.)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Like `next dev`, read .env.local when DATABASE_URL is not in the environment.
if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table schema_migrations enable row level security`;
  const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    process.stdout.write(`Applying ${file} … `);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(`${dir}${file}`, "utf8"));
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log("done");
    count++;
  }
  console.log(count ? `Applied ${count} migration(s).` : "Database is up to date.");
} catch (error) {
  console.error("\nMigration failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
