import { describe, expect, it } from "vitest";
import { addGuest, guestEntriesForContact, listGuests, removeGuest, upcomingGuestListEvents, updateGuest } from "@/lib/queries/guests";
import { listListingEvents, saveEvent } from "@/lib/queries/listings";
import { createContact } from "@/lib/queries/contacts";
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
});
