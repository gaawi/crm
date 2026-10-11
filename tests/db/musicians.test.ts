import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { runCrmTool } from "@/lib/ai/tools";
import { createContact, mergeContacts } from "@/lib/queries/contacts";
import {
  addGig,
  deleteGig,
  getMusicianProfile,
  instrumentCounts,
  listGigs,
  listMusicians,
  removeMusicianProfile,
  saveMusicianProfile,
} from "@/lib/queries/musicians";
import { useTestDatabase } from "../setup/db";

const ctx = { today: "2026-10-11", timezone: "America/New_York" };

describe("musicians roster", () => {
  useTestDatabase();

  async function seed() {
    const ana = await createContact({ name: "Ana Cellista", emails: ["ana@example.com"], status: "active" });
    const ben = await createContact({ name: "Ben Pianist", emails: ["ben@example.com"], status: "active" });
    const eva = await createContact({ name: "Eva Soprano", emails: [], status: "active" });
    await saveMusicianProfile(ana, { instruments: "violonchelo, viola de gamba", basedIn: "Madrid", roster: "roster", rating: 5, ratingNote: "Wonderful" });
    await saveMusicianProfile(ben, { instruments: ["Piano"], basedIn: "New York", roster: "maybe" });
    await saveMusicianProfile(eva, { instruments: "soprano", roster: "not_now", rating: 2 });
    await addGig(ana, { title: "Festival ADAR 2025 · Schubert", playedOn: "2025-08-02", instrument: "chelo" });
    return { ana, ben, eva };
  }

  it("saves a profile with normalized instruments and only updates the fields given", async () => {
    const { ana } = await seed();
    const p = await getMusicianProfile(ana);
    expect(p?.instruments).toEqual(["cello", "viola-da-gamba"]);
    expect(p?.rating).toBeUndefined();
    expect((await getMusicianProfile(ana, { withRating: true }))?.rating).toBe(5);

    await saveMusicianProfile(ana, { website: "https://ana.example" });
    const after = await getMusicianProfile(ana, { withRating: true });
    expect(after).toMatchObject({ instruments: ["cello", "viola-da-gamba"], basedIn: "Madrid", website: "https://ana.example", roster: "roster", rating: 5 });

    await expect(saveMusicianProfile(ana, { website: "javascript:alert(1)" })).rejects.toThrow();
    await expect(saveMusicianProfile(ana, { rating: 9 })).rejects.toThrow();
  });

  it("finds musicians by instrument in any language, roster first, ratings only on request", async () => {
    const { ana, ben } = await seed();
    const cellists = await listMusicians({ q: "cellista" });
    expect(cellists.map((m) => m.contact.id)).toEqual([ana]);
    expect(cellists[0]).toMatchObject({ gigCount: 1, lastGig: { title: "Festival ADAR 2025 · Schubert", playedOn: "2025-08-02" } });
    expect(cellists[0].rating).toBeUndefined();

    expect((await listMusicians({ q: "new york" })).map((m) => m.contact.id)).toEqual([ben]);
    expect((await listMusicians({ instrument: "piano" })).map((m) => m.contact.id)).toEqual([ben]);
    expect((await listMusicians({ playedWithUs: true })).map((m) => m.contact.id)).toEqual([ana]);
    expect((await listMusicians({ instrumentsAny: ["violin", "cello"] })).map((m) => m.contact.id)).toEqual([ana]);
    expect((await listMusicians({ instrumentsAny: ["soprano", "piano"] })).map((m) => m.contact.displayName).sort()).toEqual(["Ben Pianist", "Eva Soprano"]);
    expect((await listMusicians({ roster: "not_now" })).map((m) => m.contact.displayName)).toEqual(["Eva Soprano"]);

    const all = await listMusicians({ withRating: true });
    expect(all.map((m) => m.roster)).toEqual(["roster", "maybe", "not_now"]);
    expect(all[0]).toMatchObject({ rating: 5, ratingNote: "Wonderful" });
    expect(await instrumentCounts()).toEqual(expect.arrayContaining([{ instrument: "cello", count: 1 }, { instrument: "piano", count: 1 }]));
  });

  it("keeps gigs per contact and removes them only for that contact", async () => {
    const { ana, ben } = await seed();
    const [gig] = await listGigs(ana);
    expect(gig).toMatchObject({ instrument: "cello", playedOn: "2025-08-02" });
    await deleteGig(ben, gig.id);
    expect(await listGigs(ana)).toHaveLength(1);
    await deleteGig(ana, gig.id);
    expect(await listGigs(ana)).toHaveLength(0);
  });

  it("merging contacts keeps the musician card and the concerts", async () => {
    const { ana } = await seed();
    const dup = await createContact({ name: "Ana C.", emails: ["ana.c@example.com"], status: "active" });
    await saveMusicianProfile(dup, { instruments: "baroque cello, viola", website: "https://ana.example" });
    await addGig(dup, { title: "Gira España 2024" });
    await mergeContacts(ana, dup);
    const p = await getMusicianProfile(ana, { withRating: true });
    expect(p?.instruments).toEqual(["baroque cello", "cello", "viola", "viola-da-gamba"]);
    expect(p).toMatchObject({ website: "https://ana.example", basedIn: "Madrid", rating: 5 });
    expect(await listGigs(ana)).toHaveLength(2);

    // A source-only musician card moves over whole.
    const plain = await createContact({ name: "Carl", emails: ["carl@example.com"], status: "active" });
    const carlDup = await createContact({ name: "Carl V", emails: [], status: "active" });
    await saveMusicianProfile(carlDup, { instruments: "violin" });
    await mergeContacts(plain, carlDup);
    expect((await getMusicianProfile(plain))?.instruments).toEqual(["violin"]);
  });

  it("removing the card keeps the concerts; deleting the contact removes everything", async () => {
    const { ana } = await seed();
    await removeMusicianProfile(ana);
    expect(await getMusicianProfile(ana)).toBeNull();
    expect(await listGigs(ana)).toHaveLength(1);
    await sql`delete from contacts where id = ${ana}`;
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from musician_gigs`;
    expect(n).toBe(0);
  });

  it("Claude's find_musicians tool understands 'cellista' and never returns ratings", async () => {
    const { ana } = await seed();
    const res = await runCrmTool("find_musicians", { instrument: "cellista" }, ctx);
    expect(res.ok).toBe(true);
    const result = (res as { ok: true; result: { instruments_searched: string[]; musicians: Record<string, unknown>[] } }).result;
    expect(result.instruments_searched).toEqual(["Cello"]);
    expect(result.musicians.map((m) => m.id)).toEqual([ana]);
    expect(JSON.stringify(result)).not.toMatch(/rating|Wonderful/i);

    const none = await runCrmTool("find_musicians", { instrument: "theremin" }, ctx);
    expect(none.ok).toBe(true);
    expect(JSON.stringify(none)).toContain("No instrument matches");
  });
});
