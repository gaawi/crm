import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { getDraft } from "@/lib/queries/drafts";
import { insertAccount, useTestDatabase } from "../setup/db";

/** The approval cards say plainly when the contact wrote last ("Wrote to you"). */
describe.skipIf(process.env.SKIP_DB_TESTS === "1")("drafts: they wrote", () => {
  useTestDatabase();

  async function setup() {
    const accountId = await insertAccount("guillermo@creartbox.nyc");
    const [contact] = await sql<{ id: string }[]>`insert into contacts (name) values ('Joel Schimek') returning id`;
    await sql`insert into contact_emails (email, contact_id, is_primary) values ('joel@tulsa.org', ${contact.id}, true)`;
    const [draft] = await sql<{ id: string }[]>`
      insert into email_drafts (account_id, contact_id, to_emails, subject, body_text)
      values (${accountId}, ${contact.id}, '{joel@tulsa.org}', 'Re: Season', 'Thanks') returning id`;
    let n = 0;
    const message = async (direction: "inbound" | "outbound", at: string, automated = false) => {
      n++;
      const [m] = await sql<{ id: string }[]>`
        insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, subject, sent_at, is_automated)
        values (${accountId}, ${`m${n}`}, 't1', ${direction}, ${`Subject ${n}`}, ${at}, ${automated}) returning id`;
      const [role, email] = direction === "inbound" ? ["from", "joel@tulsa.org"] : ["to", "joel@tulsa.org"];
      await sql`insert into message_participants (message_id, role, email) values (${m.id}, ${role}, ${email})`;
    };
    return { draftId: draft.id, message };
  }

  it("is set when their email is the latest, ignoring automated replies", async () => {
    const { draftId, message } = await setup();
    expect((await getDraft(draftId))!.theyWrote).toBeNull();

    await message("outbound", "2026-09-28T10:00:00Z");
    expect((await getDraft(draftId))!.theyWrote).toBeNull();

    await message("inbound", "2026-10-02T10:00:00Z");
    await message("inbound", "2026-10-03T10:00:00Z", true);
    const wrote = (await getDraft(draftId))!.theyWrote;
    expect(wrote?.subject).toBe("Subject 2");
    expect(new Date(wrote!.at).toISOString()).toBe("2026-10-02T10:00:00.000Z");

    await message("outbound", "2026-10-04T10:00:00Z");
    expect((await getDraft(draftId))!.theyWrote).toBeNull();
  });
});
