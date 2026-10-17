import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { getScheduled } from "@/lib/queries/followups";
import { useTestDatabase } from "../setup/db";

describe("Today → Scheduled", () => {
  useTestDatabase();

  it("lists every later reminder (contacts and campaign rows) soonest first, with what to do and the campaign", async () => {
    const [sheet] = await sql<{ id: string }[]>`insert into projects (name, color, sheet) values ('Booking USA 2026/27 · CreArtBox', 'gray', true) returning id`;
    const [org] = await sql<{ id: string }[]>`insert into organizations (name, kind) values ('PCMS', 'venue') returning id`;
    const [miles] = await sql<{ id: string }[]>`
      insert into contacts (name, organization_id, follow_up_at, follow_up_note)
      values ('Miles Cohen', ${org.id}, '2027-01-05', 'Send programs + 2028-29 touring dates') returning id`;
    await sql`insert into opportunities (title, kind, project_id, organization_id, follow_up_at, next_step)
              values ('PCMS 2028-29', 'booking', ${sheet.id}, ${org.id}, '2027-02-01', 'Call if no answer')`;
    await sql`insert into contacts (name, follow_up_at) values ('Past', '2026-10-01'), ('Archived', '2027-03-01')`;
    await sql`update contacts set status = 'archived' where name = 'Archived'`;
    await sql`insert into opportunities (title, kind, project_id, follow_up_at, stage) values ('Lost one', 'booking', ${sheet.id}, '2027-01-10', 'lost')`;

    const items = await getScheduled({ today: "2026-10-17" });
    expect(items.map((i) => [i.date, i.name, i.note])).toEqual([
      ["2027-01-05", "Miles Cohen", "Send programs + 2028-29 touring dates"],
      ["2027-02-01", "PCMS", "Call if no answer"],
    ]);
    expect(items[0]).toMatchObject({ kind: "contact", contactId: miles.id, organization: "PCMS", campaign: { id: sheet.id } });
    expect(items[1]).toMatchObject({ kind: "goal", campaign: { name: "Booking USA 2026/27 · CreArtBox" } });
  });
});
