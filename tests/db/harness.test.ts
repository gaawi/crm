import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { insertAccount, useTestDatabase } from "../setup/db";

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("test database", () => {
  useTestDatabase();

  it("has the schema, seeded projects and camelCase results", async () => {
    const projects = await sql<{ name: string; sortOrder: number }[]>`select name, sort_order from projects order by sort_order`;
    expect(projects.map((p) => p.name)).toEqual(["CreArtBox", "ADAR", "Personal", "Booking", "Press", "Grants"]);
    expect(projects[0].sortOrder).toBe(1);
  });

  it("keeps dates as strings and parses timestamps", async () => {
    const [row] = await sql<{ d: string; t: Date }[]>`select '2026-09-30'::date as d, now() as t`;
    expect(row.d).toBe("2026-09-30");
    expect(row.t).toBeInstanceOf(Date);
  });

  it("inserts accounts", async () => {
    const id = await insertAccount("me@example.com", { history_id: 42 });
    const [row] = await sql<{ historyId: string }[]>`select history_id from gmail_accounts where id = ${id}`;
    expect(row.historyId).toBe("42");
  });
});
