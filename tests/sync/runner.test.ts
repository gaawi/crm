import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { handlePushNotification, runAccountJob, runCron, syncStaleAccounts, triggerAccountJob } from "@/lib/sync/runner";
import { useTestDatabase } from "../setup/db";
import { FakeGmail } from "../helpers/fake-gmail";
import { accountRow, insertConnectedAccount, storedIds, testClock, useFastGmailClients } from "../helpers/sync";

// The autopilot is another module's concern; keep the cron test independent of it.
const { autopilot } = vi.hoisted(() => ({
  autopilot: vi.fn(async () => ({ ran: false, proposed: 0, skipped: 0, errors: [] as string[] })),
}));
vi.mock("@/lib/ai/autopilot", () => ({ runAutopilotIfDue: autopilot }));

const far = () => Date.now() + 120_000;

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("runner", () => {
  useTestDatabase();
  useFastGmailClients();
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GMAIL_PUBSUB_TOPIC;
  });

  it("chains import chunks while they make progress, up to MAX_CHAIN_HOPS", async () => {
    const fake = new FakeGmail();
    fake.listPageSize = 2;
    fake.addMany(6);
    const accountId = await insertConnectedAccount(fake.email);
    const clock = testClock();
    fake.onRequest = ({ path }) => {
      if (path.startsWith("messages/")) clock.jump(120_000);
    };

    const deadline = () => Date.now() + 60_000;
    expect(await runAccountJob(accountId, "backfill", { deadline: deadline(), hop: 0, fetchImpl: fake.fetch })).toMatchObject({
      status: "progress",
    });
    expect(fake.appRequests.map((r) => [r.url, r.headers["x-crm-hop"]])).toEqual([
      [`http://localhost:3000/api/sync/${accountId}?mode=backfill`, "1"],
    ]);

    await runAccountJob(accountId, "backfill", { deadline: deadline(), hop: 3, fetchImpl: fake.fetch });
    expect(fake.appRequests).toHaveLength(1);

    vi.restoreAllMocks();
    fake.onRequest = null;
    expect(await runAccountJob(accountId, "backfill", { deadline: far(), hop: 1, fetchImpl: fake.fetch })).toMatchObject({ status: "done" });
    expect(fake.appRequests).toHaveLength(1);

    // Sync mode runs the incremental sync.
    fake.addMessage();
    expect(await runAccountJob(accountId, "sync", { deadline: far(), fetchImpl: fake.fetch })).toMatchObject({ status: "ok", added: 1 });
  });

  it("records a failed self-request", async () => {
    const fake = new FakeGmail();
    fake.appStatus = 508;
    const accountId = await insertConnectedAccount(fake.email);
    expect(await triggerAccountJob(accountId, "sync", { hop: 2, fetchImpl: fake.fetch })).toBe(false);
    expect(fake.appRequests[0].headers).toMatchObject({ authorization: "Bearer test-cron-secret", "x-crm-hop": "2" });
    expect((await accountRow(accountId)).lastError).toBe("Could not start the next sync step (HTTP 508)");
  });

  it("cron renews watches, refreshes aliases, reconciles and fans out jobs", async () => {
    process.env.GMAIL_PUBSUB_TOPIC = "projects/p/topics/gmail";
    const fake = new FakeGmail();
    fake.sendAs = [{ sendAsEmail: "alias@example.com", verificationStatus: "accepted" }];
    const stale = await insertConnectedAccount(fake.email, { backfill_status: "done", last_synced_at: new Date(Date.now() - 3_600_000) });
    const importing = await insertConnectedAccount("two@example.com", { backfill_status: "running", last_synced_at: new Date() });
    await insertConnectedAccount("gone@example.com", { status: "disconnected" });

    const summary = await runCron({ deadline: far(), fetchImpl: fake.fetch });
    expect(summary.errors).toEqual([]);
    expect(fake.watchCalls).toHaveLength(2);
    expect((await accountRow(stale)).aliases).toEqual(["alias@example.com"]);
    expect(summary.accounts).toEqual([
      { id: stale, email: fake.email, watch: true, syncTriggered: true, backfillTriggered: false },
      { id: importing, email: "two@example.com", watch: true, syncTriggered: false, backfillTriggered: true },
    ]);
    expect(fake.appRequests.map((r) => r.url).sort()).toEqual(
      [`http://localhost:3000/api/sync/${stale}?mode=sync`, `http://localhost:3000/api/sync/${importing}?mode=backfill`].sort(),
    );
    expect(autopilot).toHaveBeenCalled();
    expect(summary.autopilot).toMatchObject({ ran: false });
  });

  it("push notifications sync the account (ignoring the payload's history id) and resume a stalled import", async () => {
    const fake = new FakeGmail();
    fake.addMany(2);
    const accountId = await insertConnectedAccount(fake.email, { history_id: fake.historyId, backfill_status: "running" });
    const fresh = fake.addMessage();

    expect(await handlePushNotification({ emailAddress: "nobody@example.com", historyId: "1" }, { deadline: far(), fetchImpl: fake.fetch })).toEqual({
      status: "ignored",
      account: "nobody@example.com",
    });

    const result = await handlePushNotification({ emailAddress: "ME@example.com", historyId: "1" }, { deadline: far(), fetchImpl: fake.fetch });
    expect(result).toMatchObject({ status: "synced", sync: { status: "ok", added: 1 }, backfillTriggered: true });
    expect(await storedIds(accountId)).toEqual([fresh]);
    expect((await accountRow(accountId)).historyId).toBe(String(fake.historyId));
    expect(fake.appRequests.map((r) => r.url)).toEqual([`http://localhost:3000/api/sync/${accountId}?mode=backfill`]);
  });

  it("syncs stale accounts on page visits and restarts stalled imports", async () => {
    const fake = new FakeGmail();
    const stale = await insertConnectedAccount(fake.email, { backfill_status: "done", last_synced_at: new Date(Date.now() - 3_600_000) });
    await insertConnectedAccount("fresh@example.com", { backfill_status: "done", last_synced_at: new Date() });
    const stalled = await insertConnectedAccount("stalled@example.com", { backfill_status: "running", last_synced_at: new Date() });
    await syncStaleAccounts({ deadline: far(), fetchImpl: fake.fetch });
    expect(fake.count(/^history$/)).toBe(1);
    expect((await accountRow(stale)).lastSyncedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(fake.appRequests.map((r) => r.url)).toEqual([`http://localhost:3000/api/sync/${stalled}?mode=backfill`]);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from gmail_accounts where sync_locked_until is not null`;
    expect(n).toBe(0);
  });
});
