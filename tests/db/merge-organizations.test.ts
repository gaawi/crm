import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { useTestDatabase } from "../setup/db";

describe("merge_organizations", () => {
  useTestDatabase();

  it("moves people, campaign rows and activities to the target and keeps both organizations' details", async () => {
    const [target] = await sql<{ id: string }[]>`
      insert into organizations (name, kind, city, domains, tags, notes)
      values ('Dallas Chamber Music', 'venue', 'Dallas, TX', '{dallaschambermusic.org}', '{musical-america-2026}', 'From the list.')
      returning id`;
    const [source] = await sql<{ id: string }[]>`
      insert into organizations (name, kind, domains, tags, notes)
      values ('Dallas CMS', 'venue', '{}', '{booking}', 'Written in 2024.')
      returning id`;
    const [person] = await sql<{ id: string }[]>`insert into contacts (name, organization_id) values ('Ana', ${source.id}) returning id`;
    const [project] = await sql<{ id: string }[]>`insert into projects (name, sheet) values ('Booking USA test', true) returning id`;
    const [row] = await sql<{ id: string }[]>`
      insert into opportunities (title, kind, project_id, organization_id) values ('Dallas CMS', 'booking', ${project.id}, ${source.id}) returning id`;
    await sql`insert into activities (kind, body, organization_id) values ('note', 'Called', ${source.id})`;

    await sql`select merge_organizations(${target.id}, ${source.id}, 'Dallas Chamber Music Society')`;

    const [org] = await sql<{ name: string; city: string; domains: string[]; tags: string[]; notes: string }[]>`
      select name, city, domains, tags, notes from organizations where id = ${target.id}`;
    expect(org).toEqual({
      name: "Dallas Chamber Music Society",
      city: "Dallas, TX",
      domains: ["dallaschambermusic.org"],
      tags: ["booking", "musical-america-2026"],
      notes: "From the list.\n\nWritten in 2024.",
    });
    expect((await sql`select 1 from organizations where id = ${source.id}`).length).toBe(0);
    const [moved] = await sql<{ contact: string; row: string; activities: number }[]>`
      select (select organization_id from contacts where id = ${person.id}) contact,
             (select organization_id from opportunities where id = ${row.id}) "row",
             (select count(*)::int from activities where organization_id = ${target.id}) activities`;
    expect(moved).toEqual({ contact: target.id, row: target.id, activities: 1 });
  });
});
