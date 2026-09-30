import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import {
  deleteMessages,
  existingMessageIds,
  ingestMessages,
  markMessagesDeleted,
  updateMessageLabels,
} from "@/lib/sync/ingest";
import { useTestDatabase } from "../setup/db";
import { addr, contactByEmail, insertConnectedAccount, parsed, storedMessages } from "../helpers/sync";

const SELF = new Set(["me@example.com"]);

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("ingestMessages", () => {
  useTestDatabase();

  it("stores messages, participants and new contacts linked to the organization by domain", async () => {
    const accountId = await insertConnectedAccount("me@example.com");
    const [org] = await sql<{ id: string }[]>`insert into organizations (name, domains) values ('MoMA', '{moma.org}') returning id`;

    const result = await ingestMessages(
      accountId,
      [
        parsed({ gmailMessageId: "a1", from: addr("curator@moma.org", "The Curator"), cc: [addr("friend@gmail.com", "Friend")] }),
        parsed({
          gmailMessageId: "a2",
          from: addr("pal@gmail.com", '"Pal"'),
          hasAttachments: true,
          attachments: [{ filename: "cv.pdf", mimeType: "application/pdf", size: 1234 }],
        }),
      ],
      SELF,
    );
    expect(result).toMatchObject({ stored: 2, inserted: 2, contactsCreated: 2, failed: [] });

    const curator = await contactByEmail("curator@moma.org");
    expect(curator).toMatchObject({ name: "The Curator", status: "new", source: "gmail", organizationId: org.id, messageCount: 1 });
    expect(curator?.lastInboundAt).toBeInstanceOf(Date);
    const pal = await contactByEmail("pal@gmail.com");
    expect(pal).toMatchObject({ name: "Pal", organizationId: null });
    // cc'd on an inbound message: a participant, not a contact.
    expect(await contactByEmail("friend@gmail.com")).toBeNull();

    const participants = await sql<{ role: string; email: string }[]>`
      select mp.role, mp.email from message_participants mp join messages m on m.id = mp.message_id
       where m.gmail_message_id = 'a1' order by role, email
    `;
    expect(participants).toEqual([
      { role: "cc", email: "friend@gmail.com" },
      { role: "from", email: "curator@moma.org" },
      { role: "to", email: "me@example.com" },
    ]);
    expect(result.contactIds.sort()).toEqual([curator!.id, pal!.id].sort());
    const [files] = await sql<{ attachments: unknown; kind: string }[]>`
      select attachments, jsonb_typeof(attachments) as kind from messages where gmail_message_id = 'a2'
    `;
    expect(files).toEqual({ kind: "array", attachments: [{ filename: "cv.pdf", mimeType: "application/pdf", size: 1234 }] });
  });

  it("refreshes only labels on conflict and never duplicates participants", async () => {
    const accountId = await insertConnectedAccount("me@example.com");
    const message = parsed({ gmailMessageId: "b1", subject: "Original" });
    await ingestMessages(accountId, [message], SELF);

    const same = await ingestMessages(accountId, [message], SELF);
    expect(same).toMatchObject({ stored: 0, inserted: 0 });

    const relabeled = await ingestMessages(accountId, [{ ...message, subject: "Changed", labelIds: ["STARRED"] }], SELF);
    expect(relabeled).toMatchObject({ stored: 1, inserted: 0, contactsCreated: 0 });
    const [row] = await storedMessages(accountId);
    expect(row).toMatchObject({ subject: "Original", labelIds: ["STARRED"] });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from message_participants`;
    expect(n).toBe(2);
    expect(await existingMessageIds(accountId, ["b1", "nope"])).toEqual(new Set(["b1"]));
  });

  it("applies the auto-creation rules: outbound recipients, mass mail, automated mail, contact forms, self", async () => {
    const accountId = await insertConnectedAccount("me@example.com", { aliases: ["alias@example.com"] });
    const many = Array.from({ length: 21 }, (_, i) => addr(`list${i}@x.org`));
    await ingestMessages(
      accountId,
      [
        parsed({ direction: "outbound", from: addr("me@example.com"), to: [addr("client@acme.com", "Client")], cc: [addr("boss@acme.com")] }),
        parsed({ direction: "outbound", from: addr("me@example.com"), to: many }),
        parsed({ from: addr("news@brand.com"), isAutomated: true, automatedReason: "list_id" }),
        parsed({ from: addr("no-reply@squarespace.info"), replyTo: [addr("visitor@gmail.com", "Visitor")] }),
        // Self set passed in is stale: the alias is still excluded by the database.
        parsed({ direction: "outbound", from: addr("me@example.com"), to: [addr("alias@example.com")] }),
      ],
      SELF,
    );
    expect(await contactByEmail("client@acme.com")).toMatchObject({ name: "Client" });
    expect(await contactByEmail("boss@acme.com")).not.toBeNull();
    expect(await contactByEmail("list0@x.org")).toBeNull();
    expect(await contactByEmail("news@brand.com")).toBeNull();
    expect(await contactByEmail("no-reply@squarespace.info")).toBeNull();
    expect(await contactByEmail("alias@example.com")).toBeNull();

    const visitor = await contactByEmail("visitor@gmail.com");
    expect(visitor).toMatchObject({ name: "Visitor", messageCount: 1 });
    // A contact form counts as a message from them (reply_to participant).
    expect(visitor?.lastInboundAt).toBeInstanceOf(Date);

    const automated = await storedMessages(accountId);
    expect(automated.find((m) => m.isAutomated)).toMatchObject({ automatedReason: "list_id" });
  });

  it("adds candidates to the account's default project and fills empty names", async () => {
    const [project] = await sql<{ id: string }[]>`select id from projects where name = 'ADAR'`;
    const accountId = await insertConnectedAccount("me@example.com", { default_project_id: project.id });
    const [existing] = await sql<{ id: string }[]>`insert into contacts (name, source) values (null, 'manual') returning id`;
    await sql`insert into contact_emails (email, contact_id, is_primary) values ('known@x.org', ${existing.id}, true)`;

    const result = await ingestMessages(
      accountId,
      [parsed({ from: addr("known@x.org", "Known Person") }), parsed({ from: addr("fresh@y.org", "Fresh") })],
      SELF,
    );
    expect(result.contactsCreated).toBe(1);
    expect(await contactByEmail("known@x.org")).toMatchObject({ id: existing.id, name: "Known Person", source: "manual" });
    const members = await sql<{ email: string }[]>`
      select ce.email from contact_projects cp join contact_emails ce on ce.contact_id = cp.contact_id
       where cp.project_id = ${project.id} order by ce.email
    `;
    expect(members.map((m) => m.email)).toEqual(["fresh@y.org", "known@x.org"]);
  });

  it("never creates two contacts for one address under concurrent ingests", async () => {
    const a = await insertConnectedAccount("me@example.com");
    const b = await insertConnectedAccount("other-me@example.com");
    const self = new Set(["me@example.com", "other-me@example.com"]);
    const batches = Array.from({ length: 6 }, (_, i) =>
      ingestMessages(i % 2 ? a : b, [parsed({ from: addr("shared@x.org", "Shared") }), parsed({ from: addr(`solo${i}@x.org`) })], self),
    );
    const results = await Promise.all(batches);
    expect(results.every((r) => r.failed.length === 0)).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from contact_emails where email = 'shared@x.org'`;
    expect(n).toBe(1);
    const [{ contacts }] = await sql<{ contacts: number }[]>`select count(*)::int as contacts from contacts`;
    expect(contacts).toBe(7);
    expect((await contactByEmail("shared@x.org"))?.messageCount).toBe(6);
  });

  it("stores the rest of the batch when one message is poison", async () => {
    const accountId = await insertConnectedAccount("me@example.com");
    const hugeId = `<${randomBytes(6000).toString("hex")}@x>`;
    const result = await ingestMessages(
      accountId,
      [
        parsed({ gmailMessageId: "ok1" }),
        parsed({ gmailMessageId: "nul", subject: "bad \u0000 byte" }),
        parsed({ gmailMessageId: "huge", rfc822MessageId: hugeId }),
        parsed({ gmailMessageId: "addr", to: [addr("Not An Address"), addr("me@example.com")] }),
        parsed({ gmailMessageId: "ok2" }),
      ],
      SELF,
    );
    expect(result.failed.map((f) => f.gmailMessageId).sort()).toEqual(["huge", "nul"]);
    expect(result.failed[0].error.length).toBeGreaterThan(0);
    expect((await storedMessages(accountId)).map((m) => m.gmailMessageId)).toEqual(["addr", "ok1", "ok2"]);
    expect(result.stored).toBe(3);
  });

  it("keeps cc'd people out of awaiting-reply and clears it when they answer", async () => {
    const accountId = await insertConnectedAccount("me@example.com");
    const t0 = Date.now() - 10 * 86_400_000;
    await ingestMessages(
      accountId,
      [
        parsed({
          gmailMessageId: "out1",
          gmailThreadId: "thread",
          direction: "outbound",
          from: addr("me@example.com"),
          to: [addr("to@x.org")],
          cc: [addr("cc@x.org")],
          sentAt: new Date(t0),
        }),
      ],
      SELF,
    );
    const to = await contactByEmail("to@x.org");
    const cc = await contactByEmail("cc@x.org");
    expect(to?.awaitingReplySince?.getTime()).toBe(t0);
    expect(to?.lastOutboundAt?.getTime()).toBe(t0);
    expect(cc?.awaitingReplySince).toBeNull();
    expect(cc?.lastOutboundAt).toBeNull();
    expect(cc?.lastContactedAt?.getTime()).toBe(t0);

    await ingestMessages(
      accountId,
      [parsed({ gmailMessageId: "in1", gmailThreadId: "thread", from: addr("to@x.org"), sentAt: new Date(t0 + 3_600_000) })],
      SELF,
    );
    const answered = await contactByEmail("to@x.org");
    expect(answered?.awaitingReplySince).toBeNull();
    expect(answered?.lastInboundAt?.getTime()).toBe(t0 + 3_600_000);
  });

  it("deletes (spam), relabels and marks deleted", async () => {
    const accountId = await insertConnectedAccount("me@example.com");
    await ingestMessages(accountId, [parsed({ gmailMessageId: "d1", from: addr("x@x.org") }), parsed({ gmailMessageId: "d2" })], SELF);
    expect((await contactByEmail("x@x.org"))?.messageCount).toBe(1);

    expect(await deleteMessages(accountId, ["d1", "missing"])).toBe(1);
    expect((await contactByEmail("x@x.org"))?.messageCount).toBe(0);

    expect(await updateMessageLabels(accountId, [{ gmailMessageId: "d2", labelIds: ["STARRED"] }, { gmailMessageId: "zz", labelIds: [] }])).toBe(1);
    expect(await updateMessageLabels(accountId, [{ gmailMessageId: "d2", labelIds: ["STARRED"] }])).toBe(0);
    expect(await markMessagesDeleted(accountId, ["d2"])).toBe(1);
    expect(await markMessagesDeleted(accountId, ["d2"])).toBe(0);
    const [row] = await storedMessages(accountId);
    expect(row.labelIds).toEqual(["STARRED", "DELETED"]);
  });
});
