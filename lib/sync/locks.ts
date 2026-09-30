import "server-only";

export type LeaseKind = "sync" | "backfill";

/**
 * Lease lock stored on gmail_accounts (sync_locked_until / backfill_locked_until).
 * Atomic: UPDATE … SET <col> = now() + seconds WHERE id = $1 AND (<col> IS NULL OR <col> < now()) RETURNING.
 * A crashed holder's lease simply expires. Returns true when acquired.
 */
export async function acquireLease(accountId: string, kind: LeaseKind, seconds: number): Promise<boolean> {
  void accountId;
  void kind;
  void seconds;
  throw new Error("TODO");
}

/** Extend a held lease (long runs). */
export async function extendLease(accountId: string, kind: LeaseKind, seconds: number): Promise<void> {
  void accountId;
  void kind;
  void seconds;
  throw new Error("TODO");
}

export async function releaseLease(accountId: string, kind: LeaseKind): Promise<void> {
  void accountId;
  void kind;
  throw new Error("TODO");
}

/** Mark that another incremental sync is wanted (a push arrived while locked). */
export async function requestSync(accountId: string): Promise<void> {
  void accountId;
  throw new Error("TODO");
}

/** Atomically read-and-clear sync_requested. */
export async function takeSyncRequest(accountId: string): Promise<boolean> {
  void accountId;
  throw new Error("TODO");
}
