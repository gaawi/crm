import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import {
  acquireLease,
  extendLease,
  releaseLease,
  releaseSyncLeaseIfIdle,
  requestSync,
  takeSyncRequest,
} from "@/lib/sync/locks";
import { insertAccount, useTestDatabase } from "../setup/db";
import { accountRow } from "../helpers/sync";

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("lease locks", () => {
  useTestDatabase();

  it("grants one holder at a time per kind and lets expired leases be taken over", async () => {
    const id = await insertAccount("me@example.com");
    const attempts = await Promise.all(Array.from({ length: 5 }, () => acquireLease(id, "sync", 60)));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    // The other kind is independent.
    expect(await acquireLease(id, "backfill", 60)).toBe(true);
    expect(await acquireLease(id, "backfill", 60)).toBe(false);

    await sql`update gmail_accounts set sync_locked_until = now() - interval '1 second' where id = ${id}`;
    expect(await acquireLease(id, "sync", 60)).toBe(true);

    await extendLease(id, "sync", 600);
    const row = await accountRow(id);
    expect(row.syncLockedUntil!.getTime() - Date.now()).toBeGreaterThan(500_000);

    await releaseLease(id, "sync");
    expect((await accountRow(id)).syncLockedUntil).toBeNull();
    expect(await acquireLease(id, "sync", 60)).toBe(true);
  });

  it("coalesces sync requests and only releases the sync lease when idle", async () => {
    const id = await insertAccount("me@example.com");
    expect(await takeSyncRequest(id)).toBe(false);
    await requestSync(id);
    await requestSync(id);
    expect(await takeSyncRequest(id)).toBe(true);
    expect(await takeSyncRequest(id)).toBe(false);

    expect(await acquireLease(id, "sync", 60)).toBe(true);
    await requestSync(id);
    expect(await releaseSyncLeaseIfIdle(id)).toBe(false);
    expect((await accountRow(id)).syncLockedUntil).not.toBeNull();
    expect(await takeSyncRequest(id)).toBe(true);
    expect(await releaseSyncLeaseIfIdle(id)).toBe(true);
    expect((await accountRow(id)).syncLockedUntil).toBeNull();
  });
});
