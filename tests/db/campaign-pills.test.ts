import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { campaignsOfThread, listThreads } from "@/lib/mail/queries";
import { listDrafts } from "@/lib/queries/drafts";
import { campaignColor, campaignShortName } from "@/components/campaign-pill";
import { insertAccount, useTestDatabase } from "../setup/db";

async function contact(email: string, organizationId: string | null = null): Promise<string> {
  const [c] = await sql<{ id: string }[]>`insert into contacts (name, organization_id) values (${email}, ${organizationId}) returning id`;
  await sql`insert into contact_emails (contact_id, email, is_primary) values (${c.id}, ${email}, true)`;
  return c.id;
}

async function receive(accountId: string, thread: string, from: string) {
  const [m] = await sql<{ id: string }[]>`
    insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at, label_ids)
    values (${accountId}, ${`${thread}-1`}, ${thread}, 'inbound', ${from}, ${`About ${thread}`}, now(), '{INBOX}')
    returning id`;
  await sql`insert into message_participants (message_id, role, email) values (${m.id}, 'from', ${from})`;
  return m.id;
}

describe("campaign pills", () => {
  useTestDatabase();

  it("links a conversation and a proposal to the campaigns of its people or their organization", async () => {
    const account = await insertAccount("me@own.test", { status: "active" });
    const [booking] = await sql<{ id: string }[]>`
      insert into projects (name, color, sheet) values ('Booking USA 2026/27 · CreArtBox', 'gray', true) returning id`;
    const [partners] = await sql<{ id: string }[]>`
      insert into projects (name, color, sheet) values ('European partners · Festival ADAR', 'gray', true) returning id`;
    const [hall] = await sql<{ id: string }[]>`insert into organizations (name, kind) values ('Music Hall', 'venue') returning id`;
    // Ana is a row of the booking sheet; Ben is not, but his organization is a row of the partners sheet.
    const ana = await contact("ana@hall.test");
    await sql`insert into opportunities (title, kind, project_id, contact_id) values ('Ana', 'booking', ${booking.id}, ${ana})`;
    const ben = await contact("ben@hall.test", hall.id);
    await sql`insert into opportunities (title, kind, project_id, organization_id) values ('Music Hall', 'partnership', ${partners.id}, ${hall.id})`;
    await contact("zoe@else.test");

    await receive(account, "ta", "ana@hall.test");
    await receive(account, "tb", "ben@hall.test");
    await receive(account, "tz", "zoe@else.test");

    const threads = (await listThreads({ view: "inbox", category: "primary" })).threads;
    const names = Object.fromEntries(threads.map((t) => [t.threadId, (t.campaigns ?? []).map((c) => c.name)]));
    expect(names).toEqual({ ta: ["Booking USA 2026/27 · CreArtBox"], tb: ["European partners · Festival ADAR"], tz: [] });
    expect((await campaignsOfThread(account, "tb")).map((c) => c.id)).toEqual([partners.id]);

    await sql`
      insert into email_drafts (account_id, contact_id, to_emails, subject, body_text)
      values (${account}, ${ben}, '{ben@hall.test}', 'Hello', 'Hi Ben')`;
    const [draft] = await listDrafts();
    expect(draft.campaign).toMatchObject({ id: partners.id, name: "European partners · Festival ADAR" });
  });

  it("gives campaigns without a color a stable one of their own, and a short name", () => {
    const a = campaignColor({ id: "a1b2", name: "A", color: "gray" });
    expect(a).not.toBe("gray");
    expect(campaignColor({ id: "a1b2", name: "A", color: "gray" })).toBe(a);
    expect(campaignColor({ id: "x", name: "B", color: "teal" })).toBe("teal");
    expect(campaignShortName("Booking USA 2026/27 · CreArtBox")).toBe("Booking USA 2026/27");
  });
});
