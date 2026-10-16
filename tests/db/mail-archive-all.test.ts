import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import type { GmailListMessagesResponse } from "@/lib/gmail/types";
import { archiveAllInbox } from "@/lib/mail/gmail";
import { countInboxThreads } from "@/lib/mail/queries";
import { insertAccount, useTestDatabase } from "../setup/db";

const MODIFY = ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"];
const CATEGORIES = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

interface FakeMessage {
  id: string;
  threadId: string;
  labels: string[];
}

/** A Gmail client stand-in: messages.list (in:inbox, category:…, pages) and messages.batchModify. */
function fakeClient(messages: FakeMessage[], options: { failModify?: boolean } = {}) {
  const calls = { list: [] as { q?: string; pageToken?: string; maxResults?: number }[], modify: [] as { ids: string[]; remove: string[] }[] };
  return {
    calls,
    messages,
    async listMessages(params: { q?: string; pageToken?: string; maxResults?: number }): Promise<GmailListMessagesResponse> {
      calls.list.push(params);
      const q = params.q ?? "";
      const category = /category:(\w+)/.exec(q)?.[1];
      const matching = messages.filter((m) => {
        if (/in:inbox/.test(q) && !m.labels.includes("INBOX")) return false;
        if (category === "primary") return !m.labels.some((l) => CATEGORIES.includes(l));
        if (category) return m.labels.includes(`CATEGORY_${category.toUpperCase()}`);
        return true;
      });
      const offset = Number(params.pageToken ?? 0);
      const size = Math.min(params.maxResults ?? 100, 500);
      const page = matching.slice(offset, offset + size);
      return {
        messages: page.map((m) => ({ id: m.id, threadId: m.threadId })),
        nextPageToken: offset + size < matching.length ? String(offset + size) : undefined,
        resultSizeEstimate: matching.length,
      };
    },
    async batchModifyMessages(ids: string[], change: { removeLabelIds?: string[] }) {
      if (options.failModify) throw new Error("Gmail is down");
      expect(ids.length).toBeLessThanOrEqual(1000);
      calls.modify.push({ ids, remove: change.removeLabelIds ?? [] });
      const remove = new Set(change.removeLabelIds ?? []);
      for (const m of messages) if (ids.includes(m.id)) m.labels = m.labels.filter((l) => !remove.has(l));
    },
  };
}

function inbox(prefix: string, count: number, perThread = 1, extra: string[] = []): FakeMessage[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, threadId: `${prefix}t${Math.floor(i / perThread)}`, labels: ["INBOX", ...extra] }));
}

async function store(accountId: string, m: FakeMessage, sentAt = new Date()) {
  await sql`
    insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at, label_ids)
    values (${accountId}, ${m.id}, ${m.threadId}, 'inbound', 'x@y.test', 's', ${sentAt}, ${m.labels})`;
}

async function labelsOf(accountId: string, id: string): Promise<string[]> {
  const [row] = await sql<{ labelIds: string[] }[]>`select label_ids from messages where account_id = ${accountId} and gmail_message_id = ${id}`;
  return row.labelIds;
}

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("archive all", () => {
  useTestDatabase();

  it("pages through the inbox, archives in chunks of 1,000 and updates the stored copies", async () => {
    const accountId = await insertAccount("me@own.test", { status: "active", scopes: MODIFY });
    const messages = inbox("m", 2600, 2, ["UNREAD"]);
    const client = fakeClient(messages);
    await store(accountId, messages[0]);
    await store(accountId, messages[2599]);
    const kept = { id: "old", threadId: "old-t", labels: ["STARRED"] };
    await store(accountId, kept);
    expect(await countInboxThreads()).toBe(2);

    const result = await archiveAllInbox({}, { clientFor: () => client });
    expect(result).toEqual({ archived: 1300, messages: 2600, accounts: 1, more: false, errors: [], skipped: [] });
    expect(client.calls.list.map((c) => [c.q, c.maxResults, c.pageToken ?? null])).toEqual([
      ["in:inbox", 500, null],
      ["in:inbox", 500, "500"],
      ["in:inbox", 500, "1000"],
      ["in:inbox", 500, "1500"],
      ["in:inbox", 500, "2000"],
      ["in:inbox", 500, "2500"],
    ]);
    expect(client.calls.modify.map((c) => [c.ids.length, c.remove])).toEqual([
      [1000, ["INBOX"]],
      [1000, ["INBOX"]],
      [600, ["INBOX"]],
    ]);
    expect(messages.every((m) => !m.labels.includes("INBOX"))).toBe(true);
    expect(await labelsOf(accountId, "m0")).toEqual(["UNREAD"]);
    expect(await labelsOf(accountId, "m2599")).toEqual(["UNREAD"]);
    expect(await labelsOf(accountId, "old")).toEqual(["STARRED"]);
    expect(await countInboxThreads()).toBe(0);
  });

  it("archives one tab with Gmail's category query", async () => {
    const accountId = await insertAccount("me@own.test", { status: "active", scopes: MODIFY });
    const promos = inbox("p", 3, 1, ["CATEGORY_PROMOTIONS"]);
    const primary = inbox("q", 2);
    const client = fakeClient([...promos, ...primary]);
    for (const m of [...promos, ...primary]) await store(accountId, m);
    expect(await countInboxThreads({ category: "promotions" })).toBe(3);
    expect(await countInboxThreads({ category: "primary" })).toBe(2);

    const result = await archiveAllInbox({ category: "promotions" }, { clientFor: () => client });
    expect(result).toMatchObject({ archived: 3, messages: 3 });
    expect(client.calls.list[0].q).toBe("in:inbox category:promotions");
    expect(await labelsOf(accountId, "p0")).toEqual(["CATEGORY_PROMOTIONS"]);
    expect(await labelsOf(accountId, "q0")).toEqual(["INBOX"]);
    expect(await countInboxThreads({ category: "primary" })).toBe(2);

    // Vela's Important tab is Vela's triage, not a Gmail search: the stored inbox copies list it.
    await archiveAllInbox({ category: "primary" }, { clientFor: () => client });
    expect(client.calls.list).toHaveLength(1);
    expect(await labelsOf(accountId, "q0")).toEqual([]);
    expect(await countInboxThreads()).toBe(0);
  });

  it("archives one account or every active one, skipping those to reconnect", async () => {
    const a = await insertAccount("a@own.test", { status: "active", scopes: MODIFY });
    const b = await insertAccount("b@own.test", { status: "active", scopes: MODIFY });
    const readOnly = await insertAccount("r@own.test", { status: "active", scopes: ["https://www.googleapis.com/auth/gmail.readonly"] });
    const reauth = await insertAccount("x@own.test", { status: "reauth_required", scopes: MODIFY });
    await insertAccount("gone@own.test", { status: "disconnected", scopes: MODIFY });
    const clients = new Map([
      [a, fakeClient(inbox("a", 2))],
      [b, fakeClient(inbox("b", 3))],
      [readOnly, fakeClient(inbox("r", 1))],
      [reauth, fakeClient(inbox("x", 1))],
    ]);
    const clientFor = (id: string) => {
      const client = clients.get(id);
      if (!client) throw new Error(`unexpected account ${id}`);
      return client;
    };
    await store(b, clients.get(b)!.messages[0]);

    const one = await archiveAllInbox({ accountId: a }, { clientFor });
    expect(one).toMatchObject({ archived: 2, accounts: 1, skipped: [] });
    expect(clients.get(b)!.calls.list).toEqual([]);

    const all = await archiveAllInbox({}, { clientFor });
    expect(all).toMatchObject({ archived: 3, messages: 3, accounts: 2 }); // a's inbox is empty now
    expect(all.skipped.map((s) => s.email)).toEqual(["r@own.test", "x@own.test"]);
    expect(clients.get(readOnly)!.calls.list).toEqual([]);
    expect(clients.get(reauth)!.calls.list).toEqual([]);
    expect(await labelsOf(b, "b0")).toEqual([]);

    await expect(archiveAllInbox({ accountId: reauth }, { clientFor })).rejects.toThrow(/Reconnect x@own.test/);
    await expect(archiveAllInbox({ accountId: readOnly }, { clientFor })).rejects.toThrow(/allow changes/);
  });

  it("stops at the per-call cap and reports what is left; one failing account does not stop the others", async () => {
    const a = await insertAccount("a@own.test", { status: "active", scopes: MODIFY });
    const b = await insertAccount("b@own.test", { status: "active", scopes: MODIFY });
    const big = fakeClient(inbox("a", 1200));
    const broken = fakeClient(inbox("b", 2), { failModify: true });
    const clientFor = (id: string) => (id === a ? big : broken);

    const result = await archiveAllInbox({}, { clientFor, maxPerAccount: 1000 });
    expect(result).toMatchObject({ archived: 1000, messages: 1000, accounts: 1, more: true });
    expect(result.errors).toEqual([{ accountId: b, email: "b@own.test", error: "Gmail is down" }]);
    expect(big.calls.list).toHaveLength(2);
    expect(big.messages.filter((m) => m.labels.includes("INBOX"))).toHaveLength(200);

    // Again: the rest.
    expect(await archiveAllInbox({ accountId: a }, { clientFor, maxPerAccount: 1000 })).toMatchObject({ archived: 200, more: false });
    // Nothing could be archived at all: the error itself.
    await expect(archiveAllInbox({ accountId: b }, { clientFor })).rejects.toThrow(/Gmail is down/);
  });
});
