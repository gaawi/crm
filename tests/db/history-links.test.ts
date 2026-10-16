import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { buildAssistantContext } from "@/lib/assistant/context";
import { addSheetRow, createSheet } from "@/lib/queries/booking";
import { getRelatedHistory, linkOrganizations } from "@/lib/queries/organizations";
import { isOlderHistoryQuery, olderHistoryQuery } from "@/lib/sync/backfill";
import { insertAccount, useTestDatabase } from "../setup/db";

/** People and organizations stay connected, and the earlier emails with an organization are found. */
describe.skipIf(process.env.SKIP_DB_TESTS === "1")("history across a person and their organization", () => {
  useTestDatabase();

  let n = 0;
  async function message(accountId: string, direction: "inbound" | "outbound", email: string, at: string, automated = false) {
    n++;
    const [m] = await sql<{ id: string }[]>`
      insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, subject, body_text, sent_at, is_automated)
      values (${accountId}, ${`m${n}`}, ${`t${n}`}, ${direction}, ${`Subject ${n}`}, 'Hello', ${at}, ${automated}) returning id`;
    await sql`insert into message_participants (message_id, role, email) values (${m.id}, ${direction === "inbound" ? "from" : "to"}, ${email})`;
    return m.id;
  }
  async function contact(name: string, email: string, organizationId: string | null = null) {
    const [c] = await sql<{ id: string }[]>`insert into contacts (name, organization_id) values (${name}, ${organizationId}) returning id`;
    await sql`insert into contact_emails (email, contact_id, is_primary) values (${email}, ${c.id}, true)`;
    return c.id;
  }

  it("fills domains from the website and work addresses, and links unaffiliated contacts", async () => {
    const [org] = await sql<
      { id: string }[]
    >`insert into organizations (name, website) values ('Fontana', 'https://www.fontanamusic.org/') returning id`;
    const [shared1] = await sql<{ id: string }[]>`insert into organizations (name, domains) values ('Series A', '{uni.edu}') returning id`;
    await sql`insert into organizations (name, domains) values ('Series B', '{uni.edu}')`;
    await contact("Current director", "new@fontanamusic.org", org.id);
    const former = await contact("Former director", "old@fontanamusic.org");
    const gmailUser = await contact("Someone", "someone@gmail.com");
    const atUni = await contact("At uni", "x@uni.edu");

    const result = await linkOrganizations();
    expect(result.contactsLinked).toBe(1);
    const [{ domains }] = await sql<{ domains: string[] }[]>`select domains from organizations where id = ${org.id}`;
    expect(domains).toEqual(["fontanamusic.org"]);
    const orgOf = async (id: string) => (await sql<{ o: string | null }[]>`select organization_id as o from contacts where id = ${id}`)[0].o;
    expect(await orgOf(former)).toBe(org.id);
    expect(await orgOf(gmailUser)).toBeNull();
    expect(await orgOf(atUni)).toBeNull(); // a domain two organizations share links no one
    expect(shared1.id).toBeTruthy();
    expect((await linkOrganizations()).contactsLinked).toBe(0); // safe to run again
  });

  it("finds the organization's emails when there is nothing with the person", async () => {
    const account = await insertAccount("josefinaupd@gmail.com", { monitor_only: true });
    const [org] = await sql<{ id: string }[]>`insert into organizations (name, domains) values ('Fontana', '{fontanamusic.org}') returning id`;
    const current = await contact("Current director", "new@fontanamusic.org", org.id);
    await message(account, "outbound", "old@fontanamusic.org", "2018-03-01T10:00:00Z");
    await message(account, "inbound", "old@fontanamusic.org", "2018-03-05T10:00:00Z");
    await message(account, "inbound", "newsletter@fontanamusic.org", "2019-01-01T10:00:00Z", true);

    const before = await getRelatedHistory(current, org.id);
    expect(before.map((m) => m.about)).toEqual(["organization", "organization"]);
    expect(before.map((m) => m.direction)).toEqual(["inbound", "outbound"]);

    await message(account, "outbound", "new@fontanamusic.org", "2026-10-01T10:00:00Z");
    const after = await getRelatedHistory(current, org.id);
    expect(after[0].about).toBe("person");
    expect(after).toHaveLength(3);
  });

  it("tells the writer a new person at a known organization from a true first contact", async () => {
    const account = await insertAccount("guillermo@creartbox.nyc");
    const sheet = await createSheet({ name: "Booking USA", phonePrefix: "+1" });
    await sql`update projects set assistant_active = true where id = ${sheet}`;
    await addSheetRow({
      projectId: sheet,
      organization: "Fontana",
      website: "https://fontanamusic.org",
      contactName: "New director",
      email: "new@fontanamusic.org",
    });
    await addSheetRow({ projectId: sheet, organization: "Brand new series", contactName: "Someone", email: "a@brandnew.org" });
    await message(account, "inbound", "old@fontanamusic.org", "2018-03-05T10:00:00Z");
    const project = (await buildAssistantContext()).projects.find((p) => p.id === sheet)!;
    const byOrg = new Map(project.rows.map((r) => [r.organization?.name, r]));
    expect(byOrg.get("Fontana")?.relationship).toBe("known_organization");
    expect(byOrg.get("Fontana")?.organizationHistory.count).toBe(1);
    expect(byOrg.get("Fontana")?.organizationHistory.theyWrote).toBe(true);
    expect(byOrg.get("Brand new series")?.relationship).toBe("new");
  });

  it("builds the older-history query from the oldest stored email", () => {
    const query = olderHistoryQuery(new Date("2021-10-10T00:16:13Z"));
    expect(query.startsWith("before:2021/10/11 ")).toBe(true);
    expect(query).toContain("-category:promotions");
    expect(isOlderHistoryQuery(query)).toBe(true);
    expect(isOlderHistoryQuery("newer_than:5y -in:chats")).toBe(false);
  });
});
