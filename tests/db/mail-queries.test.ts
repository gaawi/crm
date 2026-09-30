import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { applyLabelChange, getMailCounts, listThreads } from "@/lib/mail/queries";
import { parseMailQuery } from "@/lib/mail/search";
import { insertAccount, useTestDatabase } from "../setup/db";


interface Spec {
  account: string;
  id: string;
  thread?: string;
  direction?: "inbound" | "outbound";
  from?: string;
  fromName?: string;
  to?: string[];
  subject?: string;
  body?: string;
  at: string;
  labels?: string[];
  attachments?: boolean;
}

async function msg(s: Spec) {
  const direction = s.direction ?? "inbound";
  const from = s.from ?? (direction === "outbound" ? "me@own.test" : "anna@venue.test");
  const [row] = await sql<{ id: string }[]>`
    insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, from_name,
                          subject, snippet, body_text, sent_at, label_ids, has_attachments)
    values (${s.account}, ${s.id}, ${s.thread ?? s.id}, ${direction}, ${from}, ${s.fromName ?? null},
            ${s.subject ?? "Hello"}, ${(s.body ?? "snippet " + s.id).slice(0, 40)}, ${s.body ?? null}, ${new Date(s.at)},
            ${s.labels ?? (direction === "outbound" ? ["SENT"] : ["INBOX"])}::text[], ${s.attachments ?? false})
    returning id
  `;
  await sql`insert into message_participants (message_id, role, email) values (${row.id}, 'from', ${from})`;
  for (const to of s.to ?? [direction === "outbound" ? "anna@venue.test" : "me@own.test"]) {
    await sql`insert into message_participants (message_id, role, email) values (${row.id}, 'to', ${to})`;
  }
}

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("listThreads", () => {
  useTestDatabase();

  it("groups messages into threads ordered by the latest matching message", async () => {
    const a = await insertAccount("me@own.test");
    await msg({ account: a, id: "m1", thread: "t1", at: "2026-09-01T10:00:00Z", subject: "Concert date", labels: ["INBOX", "UNREAD"] });
    await msg({ account: a, id: "m2", thread: "t1", direction: "outbound", at: "2026-09-02T10:00:00Z", subject: "Re: Concert date" });
    await msg({ account: a, id: "m3", thread: "t1", at: "2026-09-03T10:00:00Z", subject: "Re: Concert date", labels: ["INBOX"] });
    await msg({ account: a, id: "m4", thread: "t2", at: "2026-09-02T12:00:00Z", subject: "Grant", labels: ["INBOX", "STARRED"] });

    const { threads, next } = await listThreads({ view: "inbox" });
    expect(next).toBeNull();
    expect(threads.map((t) => t.threadId)).toEqual(["t1", "t2"]);
    const t1 = threads[0];
    expect(t1.messageCount).toBe(3);
    expect(t1.subject).toBe("Concert date");
    expect(t1.snippet).toBe("snippet m3");
    expect(t1.unread).toBe(true);
    expect(t1.senders.map((s) => s.outbound)).toEqual([false, true, false]);
    expect(threads[1].starred).toBe(true);

    const starred = await listThreads({ view: "starred" });
    expect(starred.threads.map((t) => t.threadId)).toEqual(["t2"]);
    const sent = await listThreads({ view: "sent" });
    expect(sent.threads.map((t) => t.threadId)).toEqual(["t1"]);
  });

  it("separates inbox tabs and hides trash and spam", async () => {
    const a = await insertAccount("me@own.test");
    await msg({ account: a, id: "p", at: "2026-09-01T10:00:00Z", labels: ["INBOX", "CATEGORY_PERSONAL"] });
    await msg({ account: a, id: "promo", at: "2026-09-02T10:00:00Z", labels: ["INBOX", "CATEGORY_PROMOTIONS", "UNREAD"] });
    await msg({ account: a, id: "gone", at: "2026-09-03T10:00:00Z", labels: ["TRASH"] });
    await msg({ account: a, id: "spam", at: "2026-09-03T11:00:00Z", labels: ["SPAM", "INBOX"] });

    expect((await listThreads({ view: "inbox" })).threads.map((t) => t.threadId)).toEqual(["p"]);
    expect((await listThreads({ view: "inbox", category: "promotions" })).threads.map((t) => t.threadId)).toEqual(["promo"]);
    expect((await listThreads({ view: "trash" })).threads.map((t) => t.threadId)).toEqual(["gone"]);
    expect((await listThreads({ view: "all" })).threads.map((t) => t.threadId)).toEqual(["promo", "p"]);

    const counts = await getMailCounts();
    expect(counts.inbox.promotions).toBe(1);
    expect(counts.inbox.primary).toBe(0);
  });

  it("filters by account and paginates without repeating threads", async () => {
    const a = await insertAccount("me@own.test");
    const b = await insertAccount("other@own.test");
    for (let i = 0; i < 7; i++) {
      await msg({ account: i % 2 ? b : a, id: `x${i}`, at: `2026-09-0${i + 1}T10:00:00Z` });
    }
    // An older message in the newest thread must not bring it back on page 2.
    await msg({ account: a, id: "x6-old", thread: "x6", at: "2026-08-01T10:00:00Z" });

    const page1 = await listThreads({ view: "inbox", limit: 3 });
    expect(page1.threads.map((t) => t.threadId)).toEqual(["x6", "x5", "x4"]);
    const page2 = await listThreads({ view: "inbox", limit: 3, cursor: page1.next });
    expect(page2.threads.map((t) => t.threadId)).toEqual(["x3", "x2", "x1"]);
    const page3 = await listThreads({ view: "inbox", limit: 3, cursor: page2.next });
    expect(page3.threads.map((t) => t.threadId)).toEqual(["x0"]);
    expect(page3.next).toBeNull();

    const onlyB = await listThreads({ view: "inbox", accountId: b });
    expect(onlyB.threads.map((t) => t.threadId)).toEqual(["x5", "x3", "x1"]);
    expect(onlyB.threads.every((t) => t.accountEmail === "other@own.test")).toBe(true);
  });

  it("searches with Gmail operators", async () => {
    const a = await insertAccount("me@own.test");
    await msg({ account: a, id: "s1", from: "anna@venue.test", fromName: "Anna Lee", subject: "Tech rider", body: "stage plot attached", at: "2026-09-01T10:00:00Z", attachments: true });
    await msg({ account: a, id: "s2", from: "bob@fund.test", subject: "Budget", body: "the stage costs", at: "2026-09-05T10:00:00Z", labels: ["INBOX", "UNREAD"] });
    await msg({ account: a, id: "s3", direction: "outbound", to: ["bob@fund.test"], subject: "Re: Budget", at: "2026-09-06T10:00:00Z" });

    const ids = async (q: string) => (await listThreads({ view: "inbox", q })).threads.map((t) => t.threadId);
    expect(await ids("stage")).toEqual(["s2", "s1"]);
    expect(await ids("from:anna")).toEqual(["s1"]);
    expect(await ids('from:"anna lee"')).toEqual(["s1"]);
    expect(await ids("to:bob")).toEqual(["s3"]);
    expect(await ids("from:me")).toEqual(["s3"]);
    expect(await ids("has:attachment")).toEqual(["s1"]);
    expect(await ids("is:unread")).toEqual(["s2"]);
    expect(await ids("subject:budget -from:me")).toEqual(["s2"]);
    expect(await ids("after:2026/09/04 before:2026/09/06")).toEqual(["s2"]);
    expect(await ids("in:sent")).toEqual(["s3"]);
  });

  it("links the conversation to its CRM contact", async () => {
    const a = await insertAccount("me@own.test");
    const [c] = await sql<{ id: string }[]>`insert into contacts (name, status) values ('Anna Lee', 'active') returning id`;
    await sql`insert into contact_emails (email, contact_id, is_primary) values ('anna@venue.test', ${c.id}, true)`;
    await msg({ account: a, id: "c1", at: "2026-09-01T10:00:00Z" });
    const { threads } = await listThreads({ view: "inbox" });
    expect(threads[0].contact).toEqual({ id: c.id, displayName: "Anna Lee", status: "active" });
  });
});

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("applyLabelChange", () => {
  useTestDatabase();

  it("adds and removes labels on the stored thread", async () => {
    const a = await insertAccount("me@own.test");
    await msg({ account: a, id: "l1", thread: "t", at: "2026-09-01T10:00:00Z", labels: ["INBOX", "UNREAD"] });
    await msg({ account: a, id: "l2", thread: "t", at: "2026-09-02T10:00:00Z", labels: ["INBOX", "UNREAD"] });
    await applyLabelChange({ accountId: a, threadId: "t", remove: ["INBOX", "UNREAD"], add: ["STARRED"] });
    const rows = await sql<{ labelIds: string[] }[]>`select label_ids from messages order by gmail_message_id`;
    expect(rows.map((r) => r.labelIds)).toEqual([["STARRED"], ["STARRED"]]);
    await applyLabelChange({ accountId: a, threadId: "t", messageIds: ["l2"], add: ["UNREAD"] });
    const after = await sql<{ labelIds: string[] }[]>`select label_ids from messages order by gmail_message_id`;
    expect(after.map((r) => r.labelIds)).toEqual([["STARRED"], ["STARRED", "UNREAD"]]);
  });
});

describe("parseMailQuery", () => {
  it("parses operators, quotes and negation", () => {
    const f = parseMailQuery('from:"Anna Lee" -label:Promo is:read has:attachment "tech rider" older_than:2y in:anywhere');
    expect(f.from).toEqual(["anna lee"]);
    expect(f.notLabels).toEqual(["Promo", "UNREAD"]);
    expect(f.hasAttachment).toBe(true);
    expect(f.text).toBe("tech rider");
    expect(f.olderThan).toBe("2 years");
    expect(f.in).toBe("anywhere");
  });
});
