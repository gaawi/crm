import { describe, expect, it } from "vitest";
import { addGuest, guestEntriesForContact, listGuests, removeGuest, upcomingGuestListEvents, updateGuest } from "@/lib/queries/guests";
import { listListingEvents, saveEvent } from "@/lib/queries/listings";
import { createContact } from "@/lib/queries/contacts";
import { sql } from "@/lib/db";
import { useTestDatabase } from "../setup/db";

describe("guest lists", () => {
  useTestDatabase();

  it("adds a contact once per concert with 2 tickets, by hand too, and checks people in", async () => {
    const now = new Date("2026-10-26T14:00:00Z");
    const currents = await saveEvent({ title: "Currents", date: "2026-10-30", time: "19:30" });
    const illinois = await saveEvent({ title: "Illinois College", date: "2026-11-06", time: "19:30", timeZone: "America/Chicago", promote: false });
    await saveEvent({ title: "Old concert", date: "2026-09-01", time: "19:30" });

    // Concerts away from New York have a guest list but stay out of Promotion.
    expect((await upcomingGuestListEvents(now)).map((e) => e.title)).toEqual(["Currents", "Illinois College"]);
    expect((await listListingEvents()).map((e) => e.title)).not.toContain("Illinois College");
    expect((await listListingEvents({ all: true })).map((e) => e.title)).toContain("Illinois College");

    const anaka = await createContact({ name: "Anaka Weiss-Jones", emails: ["anaka@example.com"] });
    const first = await addGuest({ eventId: currents, contactId: anaka, name: "" });
    // A second tap does not duplicate her nor change her tickets.
    expect(await addGuest({ eventId: currents, contactId: anaka, name: "" })).toBe(first);
    await addGuest({ eventId: currents, name: "Press friend", email: "Press@Paper.test", tickets: 1, kind: "press", note: "Pays nothing" });
    await addGuest({ eventId: illinois, contactId: anaka, name: "" });

    const list = await listGuests(currents);
    expect(list.map((g) => [g.name, g.email, g.tickets, g.kind])).toEqual([
      ["Anaka Weiss-Jones", "anaka@example.com", 2, "guest"],
      ["Press friend", "press@paper.test", 1, "press"],
    ]);
    expect((await guestEntriesForContact(anaka)).map((g) => g.eventId).sort()).toEqual([currents, illinois].sort());
    expect((await upcomingGuestListEvents(now))[0]).toMatchObject({ guests: 2, tickets: 3 });

    await updateGuest(first, { tickets: 3, checkedIn: true });
    const [updated] = await listGuests(currents);
    expect(updated).toMatchObject({ tickets: 3 });
    expect(updated.checkedInAt).toBeInstanceOf(Date);
    await updateGuest(first, { checkedIn: false });
    expect((await listGuests(currents))[0].checkedInAt).toBeNull();
    await expect(updateGuest(first, { tickets: 0 })).rejects.toThrow(/1 to 20/);

    expect(await removeGuest(first)).toBe(currents);
    expect((await listGuests(currents)).map((g) => g.name)).toEqual(["Press friend"]);
  });

  it("keeps staff and artists with role, phone (from their contact) and call time, ordered by call time", async () => {
    const currents = await saveEvent({ title: "Currents", date: "2026-10-30", time: "19:30" });
    const inram = await createContact({ name: "Inram", emails: ["inram@example.com"] });
    await sql`update contacts set phone = '+17185550101' where id = ${inram}`;
    await addGuest({ eventId: currents, contactId: inram, name: "", kind: "staff", role: "Camera", callTime: "17:30", tickets: 1 });
    await addGuest({ eventId: currents, name: "Tao", kind: "artist", role: "Cello", phone: "917 555 0102", callTime: "16:00" });
    await addGuest({ eventId: currents, name: "Usher", kind: "staff" });

    const list = await listGuests(currents);
    expect(list.map((g) => [g.name, g.kind, g.role, g.phone, g.callTime])).toEqual([
      ["Tao", "artist", "Cello", "917 555 0102", "16:00"],
      ["Inram", "staff", "Camera", "+17185550101", "17:30"],
      ["Usher", "staff", null, null, null],
    ]);
    await expect(addGuest({ eventId: currents, name: "Late", kind: "staff", callTime: "25:00" })).rejects.toThrow(/HH:MM/);

    // Adding the same contact again keeps what was set, and only the given fields change.
    await addGuest({ eventId: currents, contactId: inram, name: "", note: "Brings the tripod" });
    const again = (await listGuests(currents)).find((g) => g.contactId === inram)!;
    expect(again).toMatchObject({ kind: "staff", role: "Camera", callTime: "17:30", note: "Brings the tripod" });
    await updateGuest(again.id, { callTime: "18:00", role: "Video" });
    expect((await listGuests(currents)).find((g) => g.contactId === inram)).toMatchObject({ callTime: "18:00", role: "Video" });
  });
});
