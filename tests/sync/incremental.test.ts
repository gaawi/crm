import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { runBackfillChunk } from "@/lib/sync/backfill";
import { foldHistory, runIncrementalSync } from "@/lib/sync/incremental";
import { acquireLease, requestSync } from "@/lib/sync/locks";
import { useTestDatabase } from "../setup/db";
import { FakeGmail } from "../helpers/fake-gmail";
import { accountRow, insertConnectedAccount, storedIds, storedMessages, testClock, useFastGmailClients } from "../helpers/sync";

// A "poison" message from Gmail: the parser is robust, so poison it after parsing
// (NUL bytes cannot be stored by Postgres) to exercise ingest's savepoints.
vi.mock("@/lib/gmail/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gmail/parse")>();
  return {
    ...actual,
    parseGmailMessage: (...args: Parameters<typeof actual.parseGmailMessage>) => {
      const result = actual.parseGmailMessage(...args);
      return result.gmailMessageId.startsWith("poison") ? { ...result, subject: "bad \u0000 subject" } : result;
    },
  };
});

const far = () => Date.now() + 120_000;

/** A mailbox with `n` messages, fully imported, history cursor at the current id. */
async function importedMailbox(n = 3) {
  const fake = new FakeGmail();
  const ids = fake.addMany(n);
  const accountId = await insertConnectedAccount(fake.email, { history_id: fake.historyId });
  expect((await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch })).status).toBe("done");
  fake.requests.length = 0;
  return { fake, ids, accountId };
}

const sync = (accountId: string, fake: FakeGmail, deadline = far()) =>
  runIncrementalSync(accountId, { deadline, fetchImpl: fake.fetch });

async function labels(accountId: string, gmailId: string): Promise<string[] | undefined> {
  return (await storedMessages(accountId)).find((m) => m.gmailMessageId === gmailId)?.labelIds;
}

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("runIncrementalSync", () => {
  useTestDatabase();
  useFastGmailClients();
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([["DRAFT"], ["SCHEDULED"]])("imports a %s that is sent later (labels change on the same message)", async (label) => {
    const { fake, accountId } = await importedMailbox();
    const draft = fake.addMessage({ from: "Me <me@example.com>", to: "booker@hall.org", labels: [label] });
    expect((await sync(accountId, fake)).added).toBe(0);
    fake.modifyLabels(draft, ["SENT"], [label]);
    expect((await sync(accountId, fake)).added).toBe(1);
    expect(await labels(accountId, draft)).toContain("SENT");
  });

  it("stores new mail and moves the cursor to the mailbox history id", async () => {
    const { fake, accountId } = await importedMailbox();
    const fresh = fake.addMessage({ from: "New Person <new@x.org>" });
    const result = await sync(accountId, fake);
    expect(result).toEqual({ status: "ok", added: 1, deleted: 0 });
    expect(await storedIds(accountId)).toContain(fresh);
    const row = await accountRow(accountId);
    expect(row.historyId).toBe(String(fake.historyId));
    expect(row.lastSyncedAt).toBeInstanceOf(Date);
    expect(row.syncLockedUntil).toBeNull();
    // Nothing new: one cheap history call, no fetches.
    fake.requests.length = 0;
    expect(await sync(accountId, fake)).toEqual({ status: "ok", added: 0, deleted: 0 });
    expect(fake.requests.map((r) => r.path)).toEqual(["history"]);
  });

  it("applies archive / read / star as label-only updates without fetching", async () => {
    const { fake, ids, accountId } = await importedMailbox();
    fake.modifyLabels(ids[0], [], ["INBOX"]);
    fake.modifyLabels(ids[1], [], ["UNREAD"]);
    fake.modifyLabels(ids[2], ["STARRED"]);
    expect(await sync(accountId, fake)).toMatchObject({ status: "ok", added: 0 });
    expect(fake.count(/^messages\//)).toBe(0);
    expect(await labels(accountId, ids[0])).toEqual(["UNREAD"]);
    expect(await labels(accountId, ids[1])).toEqual(["INBOX"]);
    expect((await labels(accountId, ids[2]))?.sort()).toEqual(["INBOX", "STARRED", "UNREAD"]);
  });

  it("keeps trashed and deleted mail (labelled), deletes spam, and restores from trash and spam", async () => {
    const { fake, ids, accountId } = await importedMailbox(4);
    fake.trash(ids[0]);
    fake.deleteForever(ids[1]);
    fake.spam(ids[2]);
    expect(await sync(accountId, fake)).toMatchObject({ status: "ok", deleted: 2 });
    expect(await labels(accountId, ids[0])).toContain("TRASH");
    expect(await labels(accountId, ids[1])).toContain("DELETED");
    expect(await storedIds(accountId)).not.toContain(ids[2]);

    fake.untrash(ids[0]);
    fake.unspam(ids[2]);
    fake.requests.length = 0;
    expect(await sync(accountId, fake)).toMatchObject({ status: "ok", added: 1 });
    expect(await labels(accountId, ids[0])).not.toContain("TRASH");
    expect(await storedIds(accountId)).toContain(ids[2]);
    // Only the message restored from spam had to be fetched.
    expect(fake.requests.filter((r) => r.path.startsWith("messages/")).map((r) => r.path)).toEqual([`messages/${ids[2]}`]);
  });

  it("ignores drafts, chats and messages that are gone before they are fetched", async () => {
    const { fake, accountId } = await importedMailbox(1);
    fake.addMessage({ labels: ["DRAFT"] });
    fake.addMessage({ labels: ["CHAT"] });
    const vanished = fake.addMessage();
    fake.deleteForever(vanished);
    const spam = fake.addMessage({ labels: ["SPAM"] });
    expect(await sync(accountId, fake)).toMatchObject({ status: "ok", added: 0 });
    expect(fake.count(/^messages\//)).toBe(0);
    expect(await storedIds(accountId)).not.toContain(spam);
    expect(await storedIds(accountId)).toHaveLength(1);
  });

  it("checkpoints the cursor after every history page", async () => {
    const { fake, accountId } = await importedMailbox(1);
    const start = fake.historyId;
    fake.historyPageSize = 2;
    const added = fake.addMany(5);
    fake.failNext(new RegExp(`^messages/${added[2]}$`), 403, { reason: "forbidden", message: "Nope" });

    const failed = await sync(accountId, fake);
    expect(failed.status).toBe("error");
    let row = await accountRow(accountId);
    expect(row.historyId).toBe(String(start + 2));
    expect(row.lastError).toMatch(/Gmail API error 403: Nope/);
    expect(row.syncLockedUntil).toBeNull();

    expect(await sync(accountId, fake)).toMatchObject({ status: "ok", added: 3 });
    row = await accountRow(accountId);
    expect(row.historyId).toBe(String(fake.historyId));
    expect(row.lastError).toBeNull();
    expect(await storedIds(accountId)).toEqual(expect.arrayContaining(added));
  });

  it("stops at the deadline and continues in a new job", async () => {
    const { fake, accountId } = await importedMailbox(1);
    const start = fake.historyId;
    fake.historyPageSize = 1;
    fake.addMany(3);
    const clock = testClock();
    fake.onRequest = ({ path }) => {
      if (path === "history") clock.jump(120_000);
    };
    expect(await sync(accountId, fake, Date.now() + 60_000)).toMatchObject({ status: "ok", added: 1 });
    expect((await accountRow(accountId)).historyId).toBe(String(start + 1));
    expect(fake.appRequests).toHaveLength(1);
    expect(fake.appRequests[0].url).toMatch(new RegExp(`/api/sync/${accountId}\\?mode=sync$`));
    expect(fake.appRequests[0].headers["x-crm-hop"]).toBe("1");
    expect(fake.appRequests[0].headers.authorization).toBe("Bearer test-cron-secret");
  });

  it("recovers from an expired history id: cursor from the profile read first, gap import scheduled", async () => {
    const { fake, accountId } = await importedMailbox(2);
    const lastSynced = new Date("2025-12-31T12:00:00Z"); // the fake mailbox clock starts 2026-01-01
    await sql`update gmail_accounts set last_synced_at = ${lastSynced} where id = ${accountId}`;
    fake.addMessage();
    fake.expireHistory();
    let profileHistoryId = "";
    fake.onRequest = ({ path }) => {
      if (path === "profile") {
        profileHistoryId = String(fake.historyId);
        fake.addMessage(); // arrives after the profile was read
      }
    };

    const result = await sync(accountId, fake);
    expect(result.status).toBe("recovered");
    const row = await accountRow(accountId);
    expect(row.historyId).toBe(profileHistoryId);
    expect(Number(row.historyId)).toBeLessThan(fake.historyId);
    const since = Math.floor((lastSynced.getTime() - 86_400_000) / 1000);
    expect(row).toMatchObject({ backfillStatus: "pending", backfillPageToken: null });
    expect(row.backfillQuery).toBe(`-in:chats -in:drafts after:${since}`);
    expect(fake.appRequests.map((r) => r.url)).toEqual([`http://localhost:3000/api/sync/${accountId}?mode=backfill`]);

    // The gap import and the next sync together store both new messages.
    fake.onRequest = null;
    expect((await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch })).status).toBe("done");
    expect(await sync(accountId, fake)).toMatchObject({ status: "ok" });
    expect(await storedIds(accountId)).toHaveLength(4);
  });

  it("recovery during an unfinished import only rewinds the import's page token", async () => {
    const fake = new FakeGmail();
    fake.addMany(2);
    const accountId = await insertConnectedAccount(fake.email, {
      history_id: 5,
      backfill_status: "running",
      backfill_page_token: "g0:100",
    });
    fake.expireHistory();
    expect((await sync(accountId, fake)).status).toBe("recovered");
    expect(await accountRow(accountId)).toMatchObject({
      backfillStatus: "running",
      backfillPageToken: null,
      historyId: String(fake.historyId),
    });
  });

  it("sets the cursor from the profile when it was never set", async () => {
    const fake = new FakeGmail();
    fake.addMany(2);
    const accountId = await insertConnectedAccount(fake.email, { history_id: null });
    expect(await sync(accountId, fake)).toEqual({ status: "ok", added: 0, deleted: 0 });
    expect((await accountRow(accountId)).historyId).toBe(String(fake.historyId));
  });

  it("returns queued when another run holds the lease, and the holder runs again", async () => {
    const { fake, accountId } = await importedMailbox(1);
    expect(await acquireLease(accountId, "sync", 300)).toBe(true);
    expect(await sync(accountId, fake)).toMatchObject({ status: "queued" });
    expect((await accountRow(accountId)).syncRequested).toBe(true);
    await sql`update gmail_accounts set sync_locked_until = null, sync_requested = false where id = ${accountId}`;

    // A push arrives while the holder is listing history.
    let pushed = false;
    let late = "";
    fake.onRequest = async ({ path }) => {
      if (path === "history" && !pushed) {
        pushed = true;
        late = fake.addMessage();
        await requestSync(accountId);
      }
    };
    const first = fake.addMessage();
    expect(await sync(accountId, fake)).toMatchObject({ status: "ok", added: 2 });
    expect(fake.count(/^history$/)).toBe(2);
    expect(await storedIds(accountId)).toEqual(expect.arrayContaining([first, late]));
    const row = await accountRow(accountId);
    expect(row).toMatchObject({ syncRequested: false, syncLockedUntil: null });
    expect(fake.appRequests).toHaveLength(0);
  });

  it("stores the rest when one message cannot be stored, records it and still advances", async () => {
    const { fake, accountId } = await importedMailbox(1);
    const good = fake.addMessage();
    fake.addMessage({ id: "poison1" });
    const after = fake.addMessage();
    const result = await sync(accountId, fake);
    expect(result).toMatchObject({ status: "ok", added: 2 });
    expect(result.error).toMatch(/1 message could not be stored \(first: poison1/);
    expect(await storedIds(accountId)).toEqual(expect.arrayContaining([good, after]));
    const row = await accountRow(accountId);
    expect(row.historyId).toBe(String(fake.historyId));
    expect(row.lastError).toMatch(/poison1/);
  });

  it("skips accounts that are not active", async () => {
    const fake = new FakeGmail();
    const accountId = await insertConnectedAccount(fake.email, { status: "disconnected" });
    expect(await sync(accountId, fake)).toMatchObject({ status: "skipped" });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("foldHistory", () => {
  const ref = (id: string, labelIds: string[] = ["INBOX"]) => ({ id, threadId: `t${id}`, labelIds });

  it("folds records in order into one action per message", () => {
    const actions = foldHistory([
      { id: "1", messagesAdded: [{ message: ref("a") }, { message: ref("d", ["DRAFT"]) }] },
      { id: "2", labelsAdded: [{ message: ref("a", ["INBOX", "STARRED"]), labelIds: ["STARRED"] }] },
      { id: "3", labelsAdded: [{ message: ref("b", ["SPAM"]), labelIds: ["SPAM"] }] },
      { id: "4", labelsAdded: [{ message: ref("b", ["SPAM", "UNREAD"]), labelIds: ["UNREAD"] }] },
      { id: "5", labelsRemoved: [{ message: ref("c", ["INBOX"]), labelIds: ["TRASH"] }] },
      { id: "6", labelsRemoved: [{ message: ref("e", []), labelIds: ["INBOX"] }] },
      { id: "7", messagesDeleted: [{ message: ref("e") }] },
      { id: "8", labelsAdded: [{ message: ref("e", ["X"]), labelIds: ["X"] }] },
    ]);
    expect(Object.fromEntries(actions)).toEqual({
      a: { kind: "upsert", labels: ["INBOX", "STARRED"] },
      b: { kind: "spam" },
      c: { kind: "upsert", labels: ["INBOX"] },
      e: { kind: "deleted" },
    });
  });
});
