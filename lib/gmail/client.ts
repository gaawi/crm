import type {
  GmailDraft,
  GmailHistoryResponse,
  GmailListMessagesResponse,
  GmailMessage,
  GmailProfile,
  GmailSendAs,
  GmailWatchResponse,
} from "@/lib/gmail/types";

/**
 * Minimal Gmail REST client (https://gmail.googleapis.com/gmail/v1/users/me/...).
 *
 * - Quota: Gmail allows 6,000 units / minute / user (messages.get = 20 units,
 *   messages.list = 5, history.list = 2, watch = 100). Requests are paced by an
 *   in-process limiter (`maxRequestsPerSecond`, default 4) shared by all calls
 *   of this client instance.
 * - Retries with exponential backoff + jitter on 429, 5xx, and 403 with reason
 *   rateLimitExceeded / userRateLimitExceeded, honouring Retry-After; rate-limit
 *   waits may add up to ~65 s (the quota window is one minute) before giving up.
 * - On 401 it calls getAccessToken(true) once and retries.
 * - Non-retryable errors throw GmailApiError (403 insufficientPermissions,
 *   400 invalid pageToken, 404, ...).
 */

export class GmailApiError extends Error {
  readonly status: number;
  /** errors[0].reason from Google's error body, if any. */
  readonly reason: string | null;
  constructor(status: number, message: string, reason: string | null = null) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
    this.reason = reason;
  }
}

export interface GmailClientOptions {
  /** Returns a valid access token; forceRefresh after a 401. */
  getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  fetch?: typeof fetch;
  maxRetries?: number;
  /** Base delay for backoff in ms (tests set 0). */
  retryBaseMs?: number;
  /** Pacing for all requests of this instance (default 4/s; tests set Infinity). */
  maxRequestsPerSecond?: number;
}

export class GmailClient {
  constructor(options: GmailClientOptions) {
    void options;
  }

  getProfile(): Promise<GmailProfile> {
    throw new Error("TODO");
  }

  listMessages(params: {
    q?: string;
    pageToken?: string;
    maxResults?: number;
    includeSpamTrash?: boolean;
    labelIds?: string[];
  }): Promise<GmailListMessagesResponse> {
    void params;
    throw new Error("TODO");
  }

  /** format=full by default. Returns null when the message no longer exists (404). */
  getMessage(id: string, format: "full" | "metadata" | "minimal" = "full"): Promise<GmailMessage | null> {
    void id;
    void format;
    throw new Error("TODO");
  }

  /** Fetch many messages with bounded concurrency (paced by the limiter); missing (404) ones are omitted. */
  getMessages(ids: string[], concurrency = 4): Promise<GmailMessage[]> {
    void ids;
    void concurrency;
    throw new Error("TODO");
  }

  /** Throws GmailApiError with status 404 when startHistoryId is too old. */
  listHistory(params: {
    startHistoryId: string;
    pageToken?: string;
    historyTypes?: ("messageAdded" | "messageDeleted" | "labelAdded" | "labelRemoved")[];
    maxResults?: number;
  }): Promise<GmailHistoryResponse> {
    void params;
    throw new Error("TODO");
  }

  watch(params: {
    topicName: string;
    labelIds?: string[];
    labelFilterBehavior?: "include" | "exclude";
  }): Promise<GmailWatchResponse> {
    void params;
    throw new Error("TODO");
  }

  stop(): Promise<void> {
    throw new Error("TODO");
  }

  listSendAs(): Promise<GmailSendAs[]> {
    throw new Error("TODO");
  }

  /** raw = base64url RFC 2822 message (see lib/gmail/mime.ts). */
  createDraft(params: { raw: string; threadId?: string }): Promise<GmailDraft> {
    void params;
    throw new Error("TODO");
  }
}
