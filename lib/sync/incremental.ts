import "server-only";

export interface SyncResult {
  status: "ok" | "queued" | "skipped" | "recovered" | "error";
  added: number;
  deleted: number;
  error?: string;
}

/**
 * Incremental sync from gmail_accounts.history_id via history.list (see
 * docs/ARCHITECTURE.md → Live sync). "queued" when another run holds the lease
 * (sync_requested is set so the holder runs again). "recovered" when the
 * history id had expired and recent mail was re-listed by date.
 */
export async function runIncrementalSync(
  accountId: string,
  options: { deadline: number; fetchImpl?: typeof fetch },
): Promise<SyncResult> {
  void accountId;
  void options;
  throw new Error("TODO");
}
