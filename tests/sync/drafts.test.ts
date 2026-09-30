import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { deleteGmailDraft, listGmailDrafts, saveGmailDraft, sendGmailDraft, updateGmailDraft } from "@/lib/sync/drafts";
import { ingestMessages } from "@/lib/sync/ingest";
import { useTestDatabase } from "../setup/db";
import { FakeGmail } from "../helpers/fake-gmail";
import { addr, contactByEmail, insertConnectedAccount, parsed, storedMessages, useFastGmailClients } from "../helpers/sync";

/** Headers of the stored draft message, decoded from the fake's copy. */
async function draftHeaders(fake: FakeGmail, draftId: string) {
  const response = await fake.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}?format=full`, {
    headers: { Authorization: "Bearer t" },
  });
  const draft = (await response.json()) as {
    message: { id: string; threadId: string; payload: { headers: { name: string; value: string }[]; body: { data: string } } };
  };
  const headers = Object.fromEntries(draft.message.payload.headers.map((h) => [h.name, h.value]));
  return { headers, threadId: draft.message.threadId, messageId: draft.message.id, body: Buffer.from(draft.message.payload.body.data, "base64url").toString("utf8") };
}

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("Gmail drafts", () => {
  useTestDatabase();
  useFastGmailClients();

  it("saves a new draft from the account's address", async () => {
    const fake = new FakeGmail();
    const accountId = await insertConnectedAccount(fake.email, { display_name: "Me Myself" });
    const draft = await saveGmailDraft({
      accountId,
      to: ["Client@Acme.com"],
      cc: ["boss@acme.com"],
      subject: "Proposal",
      body: "Hello\nthere",
      fetchImpl: fake.fetch,
    });
    const saved = await draftHeaders(fake, draft.draftId);
    expect(saved.headers).toMatchObject({ From: "Me Myself <me@example.com>", To: "client@acme.com", Cc: "boss@acme.com", Subject: "Proposal" });
    expect(saved.headers["In-Reply-To"]).toBeUndefined();
    expect(saved.body).toBe("Hello\r\nthere");
    expect(draft.gmailUrl).toBe(`https://mail.google.com/mail/?authuser=me%40example.com#drafts?compose=${saved.messageId}`);
  });

  it("replies in the thread of the same account, with headers and a Re: subject", async () => {
    const fake = new FakeGmail();
    const accountId = await insertConnectedAccount(fake.email);
    const otherId = await insertConnectedAccount("other@example.com");
    await ingestMessages(
      accountId,
      [parsed({ gmailMessageId: "g1", gmailThreadId: "thread-1", rfc822MessageId: "<orig@x>", references: "<root@x>", subject: "Concert dates" })],
      new Set([fake.email]),
    );
    await ingestMessages(
      otherId,
      [parsed({ gmailMessageId: "g2", gmailThreadId: "thread-2", rfc822MessageId: "<other@x>", subject: "Elsewhere" })],
      new Set(["other@example.com"]),
    );
    const [mine] = await sql<{ id: string }[]>`select id from messages where gmail_message_id = 'g1'`;
    const [theirs] = await sql<{ id: string }[]>`select id from messages where gmail_message_id = 'g2'`;

    const reply = await saveGmailDraft({ accountId, to: ["jane@example.org"], subject: " ", body: "Yes", replyToMessageId: mine.id, fetchImpl: fake.fetch });
    const saved = await draftHeaders(fake, reply.draftId);
    expect(saved.threadId).toBe("thread-1");
    expect(saved.headers).toMatchObject({ Subject: "Re: Concert dates", "In-Reply-To": "<orig@x>", References: "<root@x> <orig@x>" });

    const cross = await saveGmailDraft({ accountId, to: ["jane@example.org"], subject: "", body: "Hi", replyToMessageId: theirs.id, fetchImpl: fake.fetch });
    const crossSaved = await draftHeaders(fake, cross.draftId);
    expect(crossSaved.threadId).not.toBe("thread-2");
    expect(crossSaved.headers).toMatchObject({ Subject: "Re: Elsewhere", "In-Reply-To": "<other@x>" });

    // Updating keeps the thread.
    const updated = await updateGmailDraft({ accountId, draftId: reply.draftId, to: ["jane@example.org"], subject: "Re: Concert dates", body: "Yes!", fetchImpl: fake.fetch });
    expect(updated.draftId).toBe(reply.draftId);
    const after = await draftHeaders(fake, reply.draftId);
    expect(after.threadId).toBe("thread-1");
    expect(after.body).toBe("Yes!");
  });

  it("validates recipients and scopes", async () => {
    const fake = new FakeGmail();
    const accountId = await insertConnectedAccount(fake.email);
    await expect(saveGmailDraft({ accountId, to: ["not an address"], subject: "x", body: "", fetchImpl: fake.fetch })).rejects.toThrow(/Invalid To address/);
    await expect(saveGmailDraft({ accountId, to: [], subject: "x", body: "", fetchImpl: fake.fetch })).rejects.toThrow(/at least one recipient/);
    const readonly = await insertConnectedAccount("ro@example.com", { scopes: ["https://www.googleapis.com/auth/gmail.readonly"] });
    await expect(saveGmailDraft({ accountId: readonly, to: ["a@b.org"], subject: "x", body: "", fetchImpl: fake.fetch })).rejects.toThrow(
      "Reconnect ro@example.com to allow drafts",
    );
    expect(fake.draftIds()).toHaveLength(0);
  });

  it("sends a draft and stores the sent message right away", async () => {
    const fake = new FakeGmail();
    const accountId = await insertConnectedAccount(fake.email);
    const draft = await saveGmailDraft({ accountId, to: ["new.person@acme.com"], subject: "Hello", body: "Hi", fetchImpl: fake.fetch });
    const sent = await sendGmailDraft(accountId, draft.draftId, { fetchImpl: fake.fetch });
    expect(fake.draftIds()).toHaveLength(0);
    const [stored] = await storedMessages(accountId);
    expect(stored).toMatchObject({ gmailMessageId: sent.gmailMessageId, labelIds: ["SENT"], subject: "Hello" });
    expect(await contactByEmail("new.person@acme.com")).toMatchObject({ source: "gmail" });
    expect(sent.gmailThreadId).toBeTruthy();
  });

  it("lists drafts newest first and deletes them (404 tolerated)", async () => {
    const fake = new FakeGmail();
    const accountId = await insertConnectedAccount(fake.email);
    const a = await saveGmailDraft({ accountId, to: ["a@x.org"], subject: "First", body: "1", fetchImpl: fake.fetch });
    const b = await saveGmailDraft({ accountId, to: ["b@x.org"], subject: "Second", body: "2", fetchImpl: fake.fetch });
    const list = await listGmailDrafts(accountId, { fetchImpl: fake.fetch });
    expect(list.map((d) => [d.draftId, d.subject, d.to])).toEqual([
      [b.draftId, "Second", ["b@x.org"]],
      [a.draftId, "First", ["a@x.org"]],
    ]);
    expect(list[0].updatedAt).toBeInstanceOf(Date);

    await deleteGmailDraft(accountId, a.draftId, { fetchImpl: fake.fetch });
    await deleteGmailDraft(accountId, a.draftId, { fetchImpl: fake.fetch });
    expect(fake.draftIds()).toEqual([b.draftId]);
    expect(addr("x@y.z").email).toBe("x@y.z");
  });
});
