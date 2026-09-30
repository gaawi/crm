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

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/";
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_MAX_REQUESTS_PER_SECOND = 4;
/** Longest single backoff step (Retry-After may ask for more, within the budget). */
const MAX_BACKOFF_MS = 32_000;
/** Total time one request may spend waiting between retries (≈ one quota window). */
const MAX_TOTAL_WAIT_MS = 65_000;
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"]);

type QueryValue = string | number | boolean | readonly string[] | null | undefined;
type Query = Record<string, QueryValue>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Safe to repeat after a network error / timeout (the request may have reached Google). */
  idempotent?: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Spaces request starts at least 1000/rps ms apart (FIFO), across all callers of one client. */
class Pacer {
  private readonly intervalMs: number;
  private nextSlot = 0;

  constructor(maxRequestsPerSecond: number) {
    this.intervalMs =
      Number.isFinite(maxRequestsPerSecond) && maxRequestsPerSecond > 0 ? 1000 / maxRequestsPerSecond : 0;
  }

  async wait(): Promise<void> {
    if (this.intervalMs === 0) return;
    const now = performance.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.intervalMs;
    // Timers may fire a hair early; loop until the slot has really arrived.
    for (let remaining = slot - now; remaining > 0; remaining = slot - performance.now()) {
      await sleep(Math.ceil(remaining));
    }
  }
}

interface GoogleErrorBody {
  error?:
    | {
        code?: number;
        message?: string;
        status?: string;
        errors?: { reason?: string; message?: string; domain?: string }[];
        details?: { "@type"?: string; reason?: string }[];
      }
    | string;
  error_description?: string;
}

export class GmailClient {
  private readonly getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly pacer: Pacer;

  constructor(options: GmailClientOptions) {
    this.getAccessToken = options.getAccessToken;
    const custom = options.fetch;
    // Resolve the global lazily so test stubs of globalThis.fetch are honoured.
    this.fetchImpl = custom ?? ((input, init) => fetch(input, init));
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES));
    this.retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
    this.pacer = new Pacer(options.maxRequestsPerSecond ?? DEFAULT_MAX_REQUESTS_PER_SECOND);
  }

  getProfile(): Promise<GmailProfile> {
    return this.request<GmailProfile>("GET", "profile");
  }

  listMessages(params: {
    q?: string;
    pageToken?: string;
    maxResults?: number;
    includeSpamTrash?: boolean;
    labelIds?: string[];
  }): Promise<GmailListMessagesResponse> {
    return this.request<GmailListMessagesResponse>("GET", "messages", {
      query: {
        q: params.q?.trim() || undefined,
        pageToken: params.pageToken || undefined,
        maxResults: clampInt(params.maxResults, 100, 1, 500),
        includeSpamTrash: params.includeSpamTrash,
        labelIds: params.labelIds?.length ? params.labelIds : undefined,
      },
    });
  }

  /** format=full by default. Returns null when the message no longer exists (404). */
  async getMessage(id: string, format: "full" | "metadata" | "minimal" = "full"): Promise<GmailMessage | null> {
    try {
      return await this.request<GmailMessage>("GET", `messages/${encodeURIComponent(id)}`, { query: { format } });
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) return null;
      throw error;
    }
  }

  /** Fetch many messages with bounded concurrency (paced by the limiter); missing (404) ones are omitted. */
  async getMessages(ids: string[], concurrency = 4): Promise<GmailMessage[]> {
    if (ids.length === 0) return [];
    const results: (GmailMessage | null)[] = new Array<GmailMessage | null>(ids.length).fill(null);
    let next = 0;
    let failed = false;
    let failure: unknown = null;

    const worker = async () => {
      while (!failed && next < ids.length) {
        const index = next++;
        try {
          results[index] = await this.getMessage(ids[index]);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      }
    };

    const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, ids.length));
    await Promise.all(Array.from({ length: workers }, worker));
    if (failed) throw failure;
    return results.filter((message): message is GmailMessage => message !== null);
  }

  /** Throws GmailApiError with status 404 when startHistoryId is too old. */
  listHistory(params: {
    startHistoryId: string;
    pageToken?: string;
    historyTypes?: ("messageAdded" | "messageDeleted" | "labelAdded" | "labelRemoved")[];
    maxResults?: number;
  }): Promise<GmailHistoryResponse> {
    return this.request<GmailHistoryResponse>("GET", "history", {
      query: {
        startHistoryId: params.startHistoryId,
        pageToken: params.pageToken || undefined,
        maxResults: clampInt(params.maxResults, 500, 1, 500),
        historyTypes: params.historyTypes?.length ? params.historyTypes : undefined,
      },
    });
  }

  watch(params: {
    topicName: string;
    labelIds?: string[];
    labelFilterBehavior?: "include" | "exclude";
  }): Promise<GmailWatchResponse> {
    const body: Record<string, unknown> = { topicName: params.topicName };
    if (params.labelIds?.length) body.labelIds = params.labelIds;
    if (params.labelFilterBehavior) body.labelFilterBehavior = params.labelFilterBehavior;
    return this.request<GmailWatchResponse>("POST", "watch", { body, idempotent: true });
  }

  async stop(): Promise<void> {
    await this.request<unknown>("POST", "stop", { idempotent: true });
  }

  async listSendAs(): Promise<GmailSendAs[]> {
    const response = await this.request<{ sendAs?: GmailSendAs[] }>("GET", "settings/sendAs");
    return Array.isArray(response?.sendAs) ? response.sendAs : [];
  }

  /** raw = base64url RFC 2822 message (see lib/gmail/mime.ts). */
  createDraft(params: { raw: string; threadId?: string }): Promise<GmailDraft> {
    const message: { raw: string; threadId?: string } = { raw: params.raw };
    if (params.threadId) message.threadId = params.threadId;
    // Not idempotent: a draft may have been created before a network error.
    return this.request<GmailDraft>("POST", "drafts", { body: { message }, idempotent: false });
  }

  /* ---------------------------------------------------------------------- */

  private async request<T>(method: "GET" | "POST", path: string, options: RequestOptions = {}): Promise<T> {
    const url = buildUrl(path, options.query);
    const idempotent = options.idempotent ?? method === "GET";
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    let forceRefresh = false;
    let refreshed = false;
    let retries = 0;
    let rateLimitRetries = 0;
    let waitedMs = 0;

    for (;;) {
      await this.pacer.wait();
      const token = await this.getAccessToken(forceRefresh);
      forceRefresh = false;

      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";

      let response: Response;
      let text: string;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body: method === "POST" ? (body ?? "") : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        text = await response.text();
      } catch (error) {
        const delay = this.backoff(retries);
        if (idempotent && retries < this.maxRetries && waitedMs + delay <= MAX_TOTAL_WAIT_MS) {
          retries++;
          waitedMs += delay;
          await sleep(delay);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new GmailApiError(0, `Gmail API request failed: ${message}`, "networkError");
      }

      if (response.ok) {
        if (!text.trim()) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new GmailApiError(response.status, "Gmail API returned invalid JSON", "invalidResponse");
        }
      }

      const { message, reason } = parseErrorBody(text, response.status);
      const status = response.status;

      if (status === 401 && !refreshed) {
        refreshed = true;
        forceRefresh = true;
        continue;
      }

      const rateLimited = status === 429 || (status === 403 && reason !== null && RATE_LIMIT_REASONS.has(reason));
      const serverError = status >= 500 && status <= 599;
      if (rateLimited || serverError) {
        const attempt = rateLimited ? rateLimitRetries : retries;
        // Rate limits get extra attempts: the quota window is a minute, so the
        // total wait (not the attempt count) is what normally ends the retries.
        const allowed = rateLimited ? Math.max(this.maxRetries * 2, this.maxRetries) : this.maxRetries;
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const delay = retryAfter ?? this.backoff(attempt);
        if (attempt < allowed && waitedMs + delay <= MAX_TOTAL_WAIT_MS) {
          if (rateLimited) rateLimitRetries++;
          else retries++;
          waitedMs += delay;
          if (delay > 0) await sleep(delay);
          continue;
        }
      }

      throw new GmailApiError(status, message, reason);
    }
  }

  /** Exponential backoff with jitter: base·2^n (capped) plus up to one base of randomness. */
  private backoff(attempt: number): number {
    if (this.retryBaseMs === 0) return 0;
    const exponential = Math.min(MAX_BACKOFF_MS, this.retryBaseMs * 2 ** attempt);
    return Math.round(exponential + Math.random() * this.retryBaseMs);
  }
}

/* ------------------------------------------------------------------------ */

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function buildUrl(path: string, query: Query | undefined): string {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

/** Retry-After: delta-seconds or an HTTP date. Returns ms, or null when absent/invalid. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

function parseErrorBody(text: string, status: number): { message: string; reason: string | null } {
  const fallback = `Gmail API request failed with HTTP ${status}`;
  let data: GoogleErrorBody | null = null;
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === "object") data = parsed as GoogleErrorBody;
  } catch {
    data = null;
  }
  if (!data) {
    const snippet = text.trim().replace(/\s+/g, " ").slice(0, 200);
    return { message: snippet && !snippet.startsWith("<") ? `${fallback}: ${snippet}` : fallback, reason: null };
  }
  if (typeof data.error === "string") {
    return { message: data.error_description || data.error, reason: data.error };
  }
  const error = data.error;
  if (!error) return { message: fallback, reason: null };
  const reason =
    error.errors?.find((e) => typeof e?.reason === "string" && e.reason)?.reason ??
    error.details?.find((d) => typeof d?.reason === "string" && d.reason)?.reason ??
    null;
  const message =
    (typeof error.message === "string" && error.message) || error.errors?.[0]?.message || error.status || fallback;
  return { message, reason };
}
