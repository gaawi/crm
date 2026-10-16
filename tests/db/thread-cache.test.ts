import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import type { GmailThread } from "@/lib/gmail/types";
import { insertAccount, useTestDatabase } from "../setup/db";

// A fake Gmail: counts thread reads and answers modify calls with the new labels.
const gmail = vi.hoisted(() => ({ reads: 0, labels: ["INBOX", "UNREAD"] as string[], messageIds: ["m1"] }));

function thread(id: string): GmailThread {
  return {
    id,
    messages: gmail.messageIds.map((mid, i) => ({
      id: mid,
      threadId: id,
      labelIds: [...gmail.labels],
      internalDate: String(Date.UTC(2026, 9, 1 + i)),
      snippet: "Hello",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "Agent <agent@venue.test>" },
          { name: "To", value: "me@own.test" },
          { name: "Subject", value: "Booking" },
          { name: "Date", value: new Date(Date.UTC(2026, 9, 1 + i)).toUTCString() },
        ],
        body: { size: 5, data: Buffer.from("Hello").toString("base64url") },
      },
    })),
  } as unknown as GmailThread;
}

vi.mock("@/lib/sync/accounts", async (original) => ({
  ...(await original<typeof import("@/lib/sync/accounts")>()),
  gmailClientFor: () => ({
    getThread: async (id: string) => {
      gmail.reads++;
      return thread(id);
    },
    modifyThread: async (id: string, change: { addLabelIds?: string[]; removeLabelIds?: string[] }) => {
      gmail.labels = [...gmail.labels.filter((l) => !(change.removeLabelIds ?? []).includes(l)), ...(change.addLabelIds ?? [])];
      return thread(id);
    },
  }),
}));

const { applyThreadAction, fetchThreadCached, forgetThread } = await import("@/lib/mail/gmail");

const MODIFY = ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"];

describe("recent-threads cache", () => {
  useTestDatabase();
  let account: string;

  beforeEach(async () => {
    gmail.reads = 0;
    gmail.labels = ["INBOX", "UNREAD"];
    gmail.messageIds = ["m1"];
    account = await insertAccount("me@own.test", { status: "active", scopes: MODIFY });
    await sql`
      insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at, label_ids)
      values (${account}, 'm1', 't1', 'inbound', 'agent@venue.test', 'Booking', ${new Date(Date.UTC(2026, 9, 1))}, ${gmail.labels})`;
    forgetThread(account, "t1");
  });

  it("opens a thread a second time without asking Gmail again", async () => {
    const [a, b] = await Promise.all([fetchThreadCached(account, "t1"), fetchThreadCached(account, "t1")]);
    await fetchThreadCached(account, "t1");
    expect(gmail.reads).toBe(1);
    expect(a?.messages[0].unread).toBe(true);
    expect(b).toBe(a);
  });

  it("keeps the cached copy in step when Vela marks it read, and drops it on other changes", async () => {
    await fetchThreadCached(account, "t1");
    await applyThreadAction(account, "t1", "read");
    const read = await fetchThreadCached(account, "t1");
    expect(gmail.reads).toBe(1);
    expect(read?.messages[0].unread).toBe(false);
    expect(read?.labelIds).not.toContain("UNREAD");

    await applyThreadAction(account, "t1", "archive");
    const archived = await fetchThreadCached(account, "t1");
    expect(gmail.reads).toBe(2);
    expect(archived?.labelIds).not.toContain("INBOX");
  });

  it("fetches again when sync stored a newer message in the conversation", async () => {
    await fetchThreadCached(account, "t1");
    gmail.messageIds = ["m1", "m2"];
    await sql`
      insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at, label_ids)
      values (${account}, 'm2', 't1', 'inbound', 'agent@venue.test', 'Re: Booking', ${new Date(Date.UTC(2026, 9, 2))}, '{INBOX,UNREAD}')`;
    const fresh = await fetchThreadCached(account, "t1");
    expect(gmail.reads).toBe(2);
    expect(fresh?.messages.map((m) => m.gmailMessageId)).toEqual(["m1", "m2"]);
  });
});
