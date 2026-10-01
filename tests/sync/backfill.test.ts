import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { runBackfillChunk, resetBackfill } from "@/lib/sync/backfill";
import { acquireLease } from "@/lib/sync/locks";
import { useTestDatabase } from "../setup/db";
import { FakeGmail } from "../helpers/fake-gmail";
import { accountRow, insertConnectedAccount, storedIds, storedMessages, testClock, useFastGmailClients } from "../helpers/sync";

const far = () => Date.now() + 120_000;

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("runBackfillChunk", () => {
  useTestDatabase();
  useFastGmailClients();
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DB_SIZE_LIMIT_MB;
    delete process.env.SYNC_SKIP_CATEGORIES;
  });

  it("keeps a restart that happens while a chunk is running", async () => {
    const fake = new FakeGmail();
    fake.listPageSize = 10;
    fake.addMany(25);
    const accountId = await insertConnectedAccount(fake.email);
    let restarted = false;
    fake.onRequest = async ({ path }) => {
      // "Restart import" lands while the first page is being fetched.
      if (!restarted && /^messages\//.test(path)) {
        restarted = true;
        await resetBackfill(accountId);
      }
    };
    const result = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(result.status).toBe("progress");
    const row = await accountRow(accountId);
    expect(row.backfillPageToken).toBeNull(); // the restart's cursor survived
    expect(row.backfillStatus).toBe("pending");
  });

  it("imports page by page, resumes from the saved page token and marks the import done", async () => {
    const fake = new FakeGmail();
    fake.listPageSize = 10;
    const ids = fake.addMany(25);
    const accountId = await insertConnectedAccount(fake.email);

    // Chunk 1: the clock passes the deadline once the first page is fetched.
    const clock = testClock();
    const deadline = Date.now() + 60_000;
    fake.onRequest = ({ path }) => {
      if (/^messages\//.test(path) && fake.count(/^messages\//) === 10) clock.jump(120_000);
    };
    const first = await runBackfillChunk(accountId, { deadline, fetchImpl: fake.fetch });
    expect(first).toEqual({ status: "progress", scanned: 10, imported: 10 });
    let row = await accountRow(accountId);
    expect(row).toMatchObject({ backfillStatus: "running", backfillPageToken: "g0:10", backfillScanned: 10, backfillImported: 10 });
    expect(row.backfillLockedUntil).toBeNull();
    vi.restoreAllMocks();
    fake.onRequest = null;

    // Chunk 2 continues where chunk 1 stopped.
    const second = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(second).toEqual({ status: "done", scanned: 15, imported: 15 });
    expect(fake.requests.filter((r) => r.path === "messages")[1].url).toContain("pageToken=g0%3A10");
    row = await accountRow(accountId);
    expect(row).toMatchObject({ backfillStatus: "done", backfillPageToken: null, backfillScanned: 25, backfillImported: 25 });
    expect(row.backfillEstimate).toBeGreaterThanOrEqual(25);
    expect((await storedIds(accountId)).sort()).toEqual([...ids].sort());

    expect(await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch })).toMatchObject({ status: "skipped" });
  });

  it("skips ids that are already stored", async () => {
    const fake = new FakeGmail();
    fake.addMany(6);
    const accountId = await insertConnectedAccount(fake.email);
    await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    await resetBackfill(accountId);
    const newer = fake.addMany(2);
    const before = fake.count(/^messages\//);

    const result = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(result).toEqual({ status: "done", scanned: 8, imported: 2 });
    expect(fake.count(/^messages\//) - before).toBe(2);
    expect(await storedIds(accountId)).toEqual(expect.arrayContaining(newer));
    expect((await accountRow(accountId)).backfillScanned).toBe(14);
  });

  it("stops at the deadline mid-page without advancing the page token", async () => {
    const fake = new FakeGmail();
    fake.addMany(60);
    const accountId = await insertConnectedAccount(fake.email);

    expect(await runBackfillChunk(accountId, { deadline: Date.now() - 1, fetchImpl: fake.fetch })).toEqual({
      status: "progress",
      scanned: 0,
      imported: 0,
    });
    expect(fake.count(/^messages$/)).toBe(0);

    const clock = testClock();
    fake.onRequest = ({ path }) => {
      if (/^messages\//.test(path) && fake.count(/^messages\//) === 25) clock.jump(120_000);
    };
    const partial = await runBackfillChunk(accountId, { deadline: Date.now() + 60_000, fetchImpl: fake.fetch });
    expect(partial).toEqual({ status: "progress", scanned: 0, imported: 25 });
    expect(await accountRow(accountId)).toMatchObject({ backfillPageToken: null, backfillImported: 25, backfillScanned: 0 });
    vi.restoreAllMocks();
    fake.onRequest = null;

    const rest = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(rest).toEqual({ status: "done", scanned: 60, imported: 35 });
    expect(fake.count(/^messages\//)).toBe(60);
  });

  it("excludes spam, trash, drafts, chats and scheduled mail by their fetched labels", async () => {
    process.env.SYNC_SKIP_CATEGORIES = "social";
    const fake = new FakeGmail();
    fake.listIncludesEverything = true;
    const keep = fake.addMessage({ labels: ["INBOX"] });
    const promo = fake.addMessage({ labels: ["INBOX", "CATEGORY_PROMOTIONS"] });
    for (const label of ["SPAM", "TRASH", "DRAFT", "CHAT", "SCHEDULED", "CATEGORY_SOCIAL"]) fake.addMessage({ labels: [label] });
    const accountId = await insertConnectedAccount(fake.email);

    const result = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(result).toEqual({ status: "done", scanned: 8, imported: 2 });
    const stored = await storedMessages(accountId);
    expect(stored.map((m) => m.gmailMessageId).sort()).toEqual([keep, promo].sort());
    expect(stored.find((m) => m.gmailMessageId === promo)).toMatchObject({ isAutomated: true, automatedReason: "category" });
    // The listing query mirrors the label rule.
    expect(decodeURIComponent(fake.requests.find((r) => r.path === "messages")!.url.replace(/\+/g, " "))).toContain(
      "-in:chats -in:drafts -category:social",
    );
  });

  it("pauses when the database is over the size limit", async () => {
    process.env.DB_SIZE_LIMIT_MB = "1";
    const fake = new FakeGmail();
    fake.addMany(3);
    const accountId = await insertConnectedAccount(fake.email);
    const result = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/^Import paused: database is at \d+ MB \(limit 1 MB\)/);
    const row = await accountRow(accountId);
    expect(row).toMatchObject({ backfillStatus: "error", lastError: result.error, backfillLockedUntil: null });
    expect(fake.requests).toHaveLength(0);
  });

  it("restarts once from the newest mail when the saved page token is invalid", async () => {
    const fake = new FakeGmail();
    fake.addMany(5);
    const accountId = await insertConnectedAccount(fake.email, { backfill_status: "running", backfill_page_token: "stale-token" });
    const result = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(result).toEqual({ status: "done", scanned: 5, imported: 5 });
    const lists = fake.requests.filter((r) => r.path === "messages");
    expect(lists).toHaveLength(2);
    expect(lists[0].url).toContain("pageToken=stale-token");
    expect(lists[1].url).not.toContain("pageToken");
  });

  it("returns locked / skipped without touching Gmail", async () => {
    const fake = new FakeGmail();
    const accountId = await insertConnectedAccount(fake.email);
    expect(await acquireLease(accountId, "backfill", 300)).toBe(true);
    expect(await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch })).toMatchObject({ status: "locked" });
    const inactive = await insertConnectedAccount("other@example.com", { status: "reauth_required" });
    expect(await runBackfillChunk(inactive, { deadline: far(), fetchImpl: fake.fetch })).toMatchObject({ status: "skipped" });
    expect(fake.requests).toHaveLength(0);
  });

  it("keeps progress and stays running when the rate limit outlasts the client's retries", async () => {
    const fake = new FakeGmail();
    fake.listPageSize = 2;
    fake.addMany(4);
    const accountId = await insertConnectedAccount(fake.email);
    fake.onRequest = ({ path }) => {
      if (path === "messages" && fake.count(/^messages$/) === 2) {
        fake.failNext(/^messages\//, 429, { reason: "rateLimitExceeded", times: 1000 });
      }
    };
    const result = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(result).toMatchObject({ status: "progress", scanned: 2, imported: 2 });
    expect(result.error).toMatch(/429/);
    expect(await accountRow(accountId)).toMatchObject({ backfillStatus: "running", backfillPageToken: "g0:2", backfillLockedUntil: null });
  });

  it("marks the account for reconnection when the refresh token was revoked", async () => {
    const fake = new FakeGmail();
    fake.refreshError = "invalid_grant";
    fake.addMany(2);
    const accountId = await insertConnectedAccount(fake.email, {
      access_token_enc: encryptSecret("old"),
      access_token_expires_at: new Date(Date.now() - 1000),
    });
    const result = await runBackfillChunk(accountId, { deadline: far(), fetchImpl: fake.fetch });
    expect(result.status).toBe("error");
    const row = await accountRow(accountId);
    expect(row.status).toBe("reauth_required");
    expect(row.lastError).toMatch(/revoked or has expired/);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from messages`;
    expect(n).toBe(0);
  });
});
