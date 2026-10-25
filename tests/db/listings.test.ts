import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { applyListings, listingsOverview } from "@/lib/assistant/listings";
import { listingBrief } from "@/lib/listings/brief";
import { getListingEvent, partnerHistory, platformsForEvent, saveEvent, savePlatform, saveSubmission } from "@/lib/queries/listings";

import { insertAccount, useTestDatabase } from "../setup/db";

describe("listings", () => {
  useTestDatabase();

  it("stores the concert in New York time and tracks each platform's submission", async () => {
    const eventId = await saveEvent({ title: "Currents", date: "2026-10-30", time: "19:30", venue: "DiMenna Center", prices: "35 USD" });
    const event = await getListingEvent(eventId);
    expect(event?.startsAt.toISOString()).toBe("2026-10-30T23:30:00.000Z");
    expect(event?.timeZone).toBe("America/New_York");

    const skint = await savePlatform({ name: "The Skint", method: "form", cost: "free", submitUrl: "https://theskint.com/submit" });
    const eventseeker = await savePlatform({ name: "Eventseeker", method: "account", loginRequired: true, loginAccount: "guillermo@creartbox.nyc", cost: "paid", costNote: "25 USD" });

    await saveSubmission(eventId, skint, { status: "received", sentBy: "ChatGPT", confirmationUrl: "https://theskint.com/thanks" });
    // A status change alone keeps the links, the author and the first date.
    await saveSubmission(eventId, skint, { status: "published" });
    const [row] = await sql<{ status: string; sentAt: string; sentBy: string; confirmationUrl: string }[]>`
      select status, sent_at::text, sent_by, confirmation_url from listing_submissions where platform_id = ${skint}`;
    expect(row).toMatchObject({ status: "published", sentBy: "ChatGPT", confirmationUrl: "https://theskint.com/thanks" });
    expect(row.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const platforms = await platformsForEvent(eventId);
    expect(platforms.map((p) => [p.name, p.submission?.status ?? null])).toEqual([
      ["Eventseeker", null],
      ["The Skint", "published"],
    ]);

    const brief = listingBrief(event!, platforms);
    expect(brief).toContain("### 1. Eventseeker");
    expect(brief).toContain("guillermo@creartbox.nyc");
    expect(brief).toContain("NO pagues sin permiso");
    expect(brief).toContain("- The Skint: Published");
    expect(brief).not.toContain("—");
    expect(eventseeker).toBeTruthy();
  });

  it("lets an assistant add platforms by name and mark submissions by concert title", async () => {
    const first = await applyListings({
      events: [{ title: "Fall concert", date: "2026-11-20", time: "20:00" }],
      platforms: [
        { name: "New Music USA", method: "form", cost: "free", submitUrl: "https://www.newmusicusa.org/submit" },
        { name: "Time Out New York", method: "email", email: "Classical.NY@timeout.com" },
        { name: "Bad", website: "not a url" },
      ],
    });
    expect(first.events[0]).toMatchObject({ ok: true, created: true });
    expect(first.platforms.map((p) => p.ok)).toEqual([true, true, false]);

    // Same name: updated, not duplicated, and untouched fields stay.
    const second = await applyListings({
      platforms: [{ name: "new music usa", notes: "Publishes in a few days" }],
      submissions: [
        { event: "fall concert", platform: "Time Out New York", status: "sent", sentAt: "2026-10-24", sentBy: "ChatGPT" },
        { event: "Fall concert", platform: "Nowhere", status: "sent" },
      ],
    });
    expect(second.platforms[0]).toMatchObject({ ok: true, created: false });
    expect(second.submissions.map((s) => s.ok)).toEqual([true, false]);

    const overview = await listingsOverview(first.events[0].ok ? first.events[0].id : null);
    const nmu = overview.platforms.find((p) => p.name === "New Music USA");
    expect(nmu).toMatchObject({ cost: "free", submitUrl: "https://www.newmusicusa.org/submit", notes: "Publishes in a few days" });
    const timeout = overview.platforms.find((p) => p.name === "Time Out New York");
    expect(timeout).toMatchObject({ email: "classical.ny@timeout.com", submission: { status: "sent", sentAt: "2026-10-24", sentBy: "ChatGPT" } });
  });

  it("keeps a ticketing partner's tickets, relationship and email threads", async () => {
    const eventId = await saveEvent({ title: "Currents", date: "2026-10-30", time: "19:30" });
    const piptix = await savePlatform({
      name: "PipTix",
      kind: "partner",
      tier: "always",
      emailMatch: ["piptix.com"],
      relationship: { summary: "Members buy at 15 USD.", howItWorks: "Molly sends a list.", priceToMembers: "15 USD", paidToUs: "10 USD", typicalTickets: "20", login: null, contacts: [], concerts: [], timeline: [], openItems: [], notes: null, reviewedAt: "2026-10-25" },
    });
    await saveSubmission(eventId, piptix, { status: "sent", ticketsOffered: 20, memberPrice: "15 USD" });
    await saveSubmission(eventId, piptix, { ticketsTaken: 14 });
    const [p] = await platformsForEvent(eventId);
    expect(p).toMatchObject({ kind: "partner", emailMatch: ["piptix.com"], relationship: { paidToUs: "10 USD" } });
    expect(p.submission).toMatchObject({ status: "sent", ticketsOffered: 20, ticketsTaken: 14, memberPrice: "15 USD" });

    const account = await insertAccount("info@own.test", { status: "active" });
    const insert = (id: string, thread: string, from: string, at: string, direction = "inbound") => sql`
      insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, body_text, sent_at)
      values (${account}, ${id}, ${thread}, ${direction}, ${from}, ${"Tickets " + thread}, '', ${at})`;
    await insert("a", "t1", "molly@piptix.com", "2026-10-01");
    await insert("b", "t1", "info@own.test", "2026-10-02", "outbound");
    await insert("c", "t2", "someone@else.test", "2026-10-03");
    await sql`insert into message_participants (message_id, email, role) select id, from_email, 'from' from messages on conflict do nothing`;
    const emails = await partnerHistory(["piptix.com"]);
    expect(emails.map((m) => m.subject)).toEqual(["Tickets t1"]);
  });
});
