import "server-only";

export interface BackfillResult {
  status: "done" | "progress" | "locked" | "skipped" | "error";
  scanned: number;
  imported: number;
  error?: string;
}

/**
 * One resumable chunk of the historical import (see docs/ARCHITECTURE.md).
 * Stops before `deadline`. "skipped" when the account is not active or the
 * import is already done; "locked" when another chunk holds the lease.
 */
export async function runBackfillChunk(
  accountId: string,
  options: { deadline: number; fetchImpl?: typeof fetch },
): Promise<BackfillResult> {
  void accountId;
  void options;
  throw new Error("TODO");
}

/** Restart the import from the beginning (already stored messages are skipped quickly). */
export async function resetBackfill(accountId: string): Promise<void> {
  void accountId;
  throw new Error("TODO");
}
