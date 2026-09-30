import "server-only";
import { sql } from "@/lib/db";

export type LeaseKind = "sync" | "backfill";

/** Lease length used by sync jobs: a little longer than a function may run (300 s). */
export const LEASE_SECONDS = 330;

function leaseColumn(kind: LeaseKind) {
  return sql(kind === "sync" ? "sync_locked_until" : "backfill_locked_until");
}

function seconds(value: number): number {
  return Math.max(1, Math.ceil(Number.isFinite(value) ? value : LEASE_SECONDS));
}

/**
 * Lease lock stored on gmail_accounts (sync_locked_until / backfill_locked_until).
 * Atomic: UPDATE … SET <col> = now() + seconds WHERE id = $1 AND (<col> IS NULL OR <col> < now()) RETURNING.
 * A crashed holder's lease simply expires. Returns true when acquired.
 */
export async function acquireLease(accountId: string, kind: LeaseKind, leaseSeconds: number): Promise<boolean> {
  const column = leaseColumn(kind);
  const rows = await sql`
    update gmail_accounts
       set ${column} = now() + make_interval(secs => ${seconds(leaseSeconds)})
     where id = ${accountId}
       and (${column} is null or ${column} < now())
    returning id
  `;
  return rows.length > 0;
}

/** Extend a held lease (long runs). */
export async function extendLease(accountId: string, kind: LeaseKind, leaseSeconds: number): Promise<void> {
  const column = leaseColumn(kind);
  await sql`
    update gmail_accounts
       set ${column} = now() + make_interval(secs => ${seconds(leaseSeconds)})
     where id = ${accountId}
  `;
}

export async function releaseLease(accountId: string, kind: LeaseKind): Promise<void> {
  const column = leaseColumn(kind);
  await sql`update gmail_accounts set ${column} = null where id = ${accountId} and ${column} is not null`;
}

/**
 * Release the sync lease unless another run was requested meanwhile.
 * Returns false when sync_requested is set (the holder keeps the lease and loops again).
 */
export async function releaseSyncLeaseIfIdle(accountId: string): Promise<boolean> {
  const rows = await sql`
    update gmail_accounts set sync_locked_until = null
     where id = ${accountId} and not sync_requested
    returning id
  `;
  return rows.length > 0;
}

/** Mark that another incremental sync is wanted (a push arrived while locked). */
export async function requestSync(accountId: string): Promise<void> {
  await sql`update gmail_accounts set sync_requested = true where id = ${accountId} and not sync_requested`;
}

/** Atomically read-and-clear sync_requested. */
export async function takeSyncRequest(accountId: string): Promise<boolean> {
  const rows = await sql`
    update gmail_accounts set sync_requested = false
     where id = ${accountId} and sync_requested
    returning id
  `;
  return rows.length > 0;
}
