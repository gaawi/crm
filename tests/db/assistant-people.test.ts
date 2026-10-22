import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { applyPeople, nameKey } from "@/lib/assistant/people";
import { applyProfiles } from "@/lib/assistant/profiles";
import { useTestDatabase } from "../setup/db";

const SRC = "https://hall.test/staff";

describe("assistant people and booking profiles", () => {
  useTestDatabase();

  it("matches people by email or name at the organization, creates the new ones and fills only empty fields", async () => {
    const [org] = await sql<{ id: string }[]>`insert into organizations (name, domains) values ('Music Hall', '{hall.test}') returning id`;
    const [ana] = await sql<{ id: string }[]>`insert into contacts (name, organization_id, role) values ('Smith, Ana', ${org.id}, 'Owner title') returning id`;
    const [bob] = await sql<{ id: string }[]>`insert into contacts (name, organization_id) values ('Robert', ${org.id}) returning id`;
    await sql`insert into contact_emails (contact_id, email, is_primary) values (${bob.id}, 'bob@hall.test', true)`;

    const result = await applyPeople({
      organizationId: org.id,
      people: [
        { name: "Dr. Ana Smith", role: "Artistic Director", photo: "https://hall.test/ana.jpg", photoSource: SRC, sources: [SRC] },
        { name: "Robert Jones", email: "BOB@hall.test", role: "Executive Director", sources: [SRC] },
        { name: "Carla Ruiz", role: "Director of Programming", email: "carla@hall.test", linkedin: "https://www.linkedin.com/in/carla", sources: [SRC] },
        { name: "No Source", sources: [] },
      ],
    });
    expect(result).toMatchObject({ created: 1, updated: 2, failed: 1 });
    const people = await sql<{ id: string; name: string; role: string | null; photoUrl: string | null; notes: string | null }[]>`
      select id, name, role, photo_url, notes from contacts where organization_id = ${org.id} order by name`;
    expect(people.find((p) => p.id === ana.id)).toMatchObject({ role: "Owner title", photoUrl: "https://hall.test/ana.jpg" });
    expect(people.find((p) => p.id === bob.id)).toMatchObject({ name: "Robert", role: "Executive Director" });
    const carla = people.find((p) => p.name === "Carla Ruiz");
    expect(carla?.notes).toContain("LinkedIn: https://www.linkedin.com/in/carla");
    const [email] = await sql<{ email: string; isPrimary: boolean }[]>`select email, is_primary from contact_emails where contact_id = ${carla!.id}`;
    expect(email).toEqual({ email: "carla@hall.test", isPrimary: true });
    expect(nameKey("Shain, Joshua")).toBe(nameKey("Joshua Shain"));

    // An address someone else already uses (a generic box): a new contact, the bio never lands on the other person.
    const shared = await applyPeople({
      organizationId: org.id,
      people: [{ name: "Dana White", role: "Director", email: "bob@hall.test", bio: "Dana's bio.", sources: [SRC] }],
    });
    expect(shared).toMatchObject({ created: 1, updated: 0 });
    const [bobNow] = await sql<{ notes: string | null }[]>`select notes from contacts where id = ${bob.id}`;
    expect(bobNow.notes ?? "").not.toContain("Dana");
  });

  it("merges a booking analysis into the stored profile and fills an empty website", async () => {
    const [org] = await sql<{ id: string }[]>`
      insert into organizations (name, profile) values ('Series', ${sql.json({ summary: "A chamber series.", artists: [{ name: "Merz Trio" }] })}) returning id`;
    const saved = await applyProfiles({
      profiles: [
        {
          organizationId: org.id,
          merge: true,
          organization: { website: "https://series.test", city: "Austin, TX" },
          profile: {
            booking: {
              brand: "CreArtBox",
              fit: "High",
              relationship: { status: "replied", lastSent: "2026-10-15", waitingOn: "us", summary: "They asked for videos." },
              nextStep: "Send the videos",
              signals: { chamberMusic: "yes", visual: "maybe" },
            },
          },
        },
      ],
    });
    expect(saved.updated).toBe(1);
    const [row] = await sql<{ profile: Record<string, unknown>; website: string; city: string }[]>`select profile, website, city from organizations where id = ${org.id}`;
    expect(row.profile).toMatchObject({
      summary: "A chamber series.",
      artists: [{ name: "Merz Trio" }],
      booking: { fit: "high", relationship: { status: "replied", lastSent: "2026-10-15", waitingOn: "us" }, signals: { chamberMusic: "yes" } },
    });
    expect((row.profile.booking as { signals: Record<string, unknown> }).signals.visual).toBeUndefined();
    expect(row).toMatchObject({ website: "https://series.test", city: "Austin, TX" });
  });
});
