import "server-only";
import { env } from "@/lib/env";
import { recordAccountError } from "@/lib/sync/accounts";
import { errorMessage } from "@/lib/utils";

/** Header carrying the number of self-requests in the current chain. */
export const HOP_HEADER = "x-crm-hop";

const TRIGGER_TIMEOUT_MS = 10_000;

/**
 * Request POST /api/sync/{accountId}?mode=… on this deployment
 * (Authorization: Bearer CRON_SECRET, header x-crm-hop: hop). Awaits only the
 * 202 acknowledgement (10 s timeout). Returns false (and records last_error)
 * when the request was not accepted; never throws.
 * `fetchImpl` defaults to the global fetch (tests inject a fake).
 */
export async function triggerAccountJob(
  accountId: string,
  mode: "backfill" | "sync",
  options: { hop?: number; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const hop = Math.max(0, Math.floor(Number(options.hop ?? 0) || 0));
  const job = mode === "backfill" ? "import" : "sync";
  try {
    const url = `${env.appUrl}/api/sync/${encodeURIComponent(accountId)}?mode=${mode}`;
    const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const response = await doFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.cronSecret}`, [HOP_HEADER]: String(hop) },
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    });
    await response.text().catch(() => undefined);
    if (response.status === 202 || response.ok) return true;
    await recordAccountError(accountId, `Could not start the next ${job} step (HTTP ${response.status})`).catch(() => undefined);
    return false;
  } catch (error) {
    await recordAccountError(accountId, `Could not start the next ${job} step: ${errorMessage(error)}`).catch(() => undefined);
    return false;
  }
}
