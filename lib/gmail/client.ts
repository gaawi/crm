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
 * - Retries with exponential backoff + jitter on 429, 5xx, and 403 with reason
 *   rateLimitExceeded / userRateLimitExceeded (max `maxRetries`, honours Retry-After).
 * - On 401 it calls getAccessToken(true) once and retries.
 * - Non-retryable errors throw GmailApiError.
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

  /** Fetch many messages with bounded concurrency; missing (404) ones are omitted. */
  getMessages(ids: string[], concurrency = 8): Promise<GmailMessage[]> {
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
