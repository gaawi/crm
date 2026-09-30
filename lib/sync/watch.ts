import "server-only";

/**
 * users.watch on the account's whole mailbox when GMAIL_PUBSUB_TOPIC is set;
 * stores watch_expires_at. Never moves history_id backwards (only sets it when null).
 * Returns false when push is not configured.
 */
export async function ensureWatch(accountId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  void accountId;
  void options;
  throw new Error("TODO");
}

/** users.stop — best effort. */
export async function stopWatch(accountId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  void accountId;
  void options;
  throw new Error("TODO");
}
