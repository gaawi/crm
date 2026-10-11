import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { GmailClient } from "@/lib/gmail/client";
import { applyThreadAction, archiveAllInbox, MailError } from "@/lib/mail/gmail";
import { countInboxThreads, getMailCounts, listThreads } from "@/lib/mail/queries";
import { listSendAccounts } from "@/lib/queries/booking";
import { gmailClientFor, MonitorOnlyError } from "@/lib/sync/accounts";
import { insertAccount, useTestDatabase } from "../setup/db";

const MODIFY = ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"];

async function store(accountId: string, id: string, labels: string[], subject = "s") {
  await sql`
    insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at, label_ids)
    values (${accountId}, ${id}, ${`${id}-t`}, 'inbound', 'agent@venue.test', ${subject}, now(), ${labels})`;
}

describe("GmailClient write guard", () => {
  it("lets reads and push-watch through, refuses every write before any request", async () => {
    const calls: string[] = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url).replace("https://gmail.googleapis.com/gmail/v1/users/me/", "")}`);
      return new Response(JSON.stringify({ id: "x", historyId: "1", expiration: "0", messages: [] }), { status: 200 });
    }) as typeof fetch;
    const client = new GmailClient({
      getAccessToken: async () => "token",
      fetch: fetchStub,
      maxRequestsPerSecond: Infinity,
      assertWritable: async () => {
        throw new Error("monitor only");
      },
    });
    await client.getThread("t1", "minimal");
    await client.listMessages({ q: "in:inbox" });
    await client.watch({ topicName: "projects/p/topics/t", labelIds: ["INBOX"] });
    expect(calls.map((c) => c.split("?")[0])).toEqual(["GET threads/t1", "GET messages", "POST watch"]);

    await expect(client.modifyThread("t1", { removeLabelIds: ["UNREAD"] })).rejects.toThrow("monitor only");
    await expect(client.batchModifyMessages(["m1"], { removeLabelIds: ["INBOX"] })).rejects.toThrow("monitor only");
    await expect(client.trashThread("t1")).rejects.toThrow("monitor only");
    await expect(client.createDraft({ raw: "eA" })).rejects.toThrow("monitor only");
    await expect(client.sendMessage({ raw: "eA" })).rejects.toThrow("monitor only");
    expect(calls).toHaveLength(3);
  });
});

describe("monitor-only accounts", () => {
  useTestDatabase();

  async function seed() {
    const mine = await insertAccount("me@own.test", { status: "active", scopes: MODIFY });
    const hers = await insertAccount("partner@own.test", { status: "active", scopes: MODIFY, monitor_only: true });
    await store(mine, "a1", ["INBOX", "UNREAD"], "Mine");
    await store(hers, "b1", ["INBOX", "UNREAD"], "Hers");
    return { mine, hers };
  }

  it("never reaches Gmail with a write for a monitor-only mailbox", async () => {
    const { hers } = await seed();
    // The guard runs before the token is even loaded (this account has none).
    await expect(gmailClientFor(hers).modifyThread("b1-t", { removeLabelIds: ["UNREAD"] })).rejects.toBeInstanceOf(MonitorOnlyError);
    await expect(gmailClientFor(hers).sendMessage({ raw: "eA" })).rejects.toThrow(/partner@own\.test is monitor-only/);
    await expect(applyThreadAction(hers, "b1-t", "read")).rejects.toBeInstanceOf(MailError);
    await expect(applyThreadAction(hers, "b1-t", "archive")).rejects.toThrow(/monitor-only/);
    const [row] = await sql<{ labelIds: string[] }[]>`select label_ids from messages where gmail_message_id = 'b1'`;
    expect(row.labelIds).toEqual(["INBOX", "UNREAD"]);
  });

  it("is left out of All Inboxes, its counts and Archive all, but stays in its own inbox and in search", async () => {
    const { mine, hers } = await seed();
    const all = await listThreads({ view: "inbox", category: "primary" });
    expect(all.threads.map((t) => t.subject)).toEqual(["Mine"]);
    expect((await listThreads({ view: "inbox", category: "primary", accountId: hers })).threads.map((t) => t.subject)).toEqual(["Hers"]);
    expect((await listThreads({ view: "inbox", q: "from:agent@venue.test" })).threads.map((t) => t.subject).sort()).toEqual(["Hers", "Mine"]);

    const counts = await getMailCounts();
    expect(counts.inbox.primary).toBe(1);
    expect(counts.byAccount[hers]).toBeUndefined();
    expect((await getMailCounts(hers)).inbox.primary).toBe(1);
    expect(await countInboxThreads()).toBe(1);

    const touched: string[] = [];
    const result = await archiveAllInbox(
      {},
      {
        clientFor: (id) => ({
          async listMessages() {
            touched.push(id);
            return { messages: id === mine ? [{ id: "a1", threadId: "a1-t" }] : [] };
          },
          async batchModifyMessages() {},
        }),
      },
    );
    expect(touched).toEqual([mine]);
    expect(result.accounts).toBe(1);
    await expect(archiveAllInbox({ accountId: hers })).rejects.toThrow(/monitor-only/);
  });

  it("is never offered as a send-from account", async () => {
    const { mine } = await seed();
    expect((await listSendAccounts()).map((a) => a.id)).toEqual([mine]);
  });
});
