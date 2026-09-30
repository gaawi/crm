import type { GmailHeader, GmailHistoryRecord, GmailMessage, GmailMessageRef, GmailSendAs } from "@/lib/gmail/types";

/**
 * In-memory Gmail mailbox exposed as a `fetch` implementation.
 *
 * Handles https://gmail.googleapis.com/gmail/v1/users/me/… (profile, messages
 * list/get, history, watch/stop, settings/sendAs, drafts), Google's OAuth
 * token and revoke endpoints, and the app's own self-requests
 * (http://localhost:3000/api/sync/…, recorded in `appRequests`). Anything else
 * throws, so tests can never reach the real network.
 *
 * Every mailbox change (addMessage, modifyLabels, trash, spam, deleteForever,
 * drafts) appends a history record with an incrementing id, like Gmail.
 */

export interface FakeMessageSpec {
  id?: string;
  threadId?: string;
  labels?: string[];
  /** Header values, e.g. 'Jane Doe <jane@example.org>'. */
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject?: string;
  body?: string;
  /** RFC 822 Message-ID (generated when omitted). */
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  /** Extra headers (List-Id, Precedence, …). */
  headers?: Record<string, string>;
  /** internalDate (defaults to an increasing clock). */
  date?: Date | number;
}

interface Failure {
  method?: string;
  path: RegExp;
  status: number;
  reason?: string;
  message?: string;
  times: number;
  headers?: Record<string, string>;
}

const GMAIL_PREFIX = "https://gmail.googleapis.com/gmail/v1/users/me/";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const APP_URL = "http://localhost:3000/";

const clone = <T>(value: T): T => structuredClone(value);
const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function gmailError(status: number, message: string, reason?: string): Response {
  return json(status, { error: { code: status, message, errors: reason ? [{ reason, message }] : [], status: "ERROR" } });
}

export class FakeGmail {
  readonly email: string;
  historyId = 1000;
  /** history.list with startHistoryId below this answers 404 (history expired). */
  historyFloor = 0;
  /** Largest messages.list page (the client asks for 100). */
  listPageSize = 100;
  /** Largest history.list page (the client asks for 500). */
  historyPageSize = 500;
  /** When true messages.list also returns spam/trash (to exercise the fetched-label filter). */
  listIncludesEverything = false;
  /** Scopes granted by the token endpoint. */
  scope = "openid email profile https://www.googleapis.com/auth/gmail.modify";
  /** Refresh-token grant error code (e.g. "invalid_grant"), or null for success. */
  refreshError: string | null = null;
  /** Authorization-code grant: returned refresh token (null = Google omitted it). */
  codeRefreshToken: string | null = "refresh-from-code";
  /** Status the fake app answers self-requests with. */
  appStatus = 202;
  sendAs: GmailSendAs[] = [];
  messagesTotalOverride: number | null = null;
  /**
   * Called after each Gmail API request is answered (e.g. to move a test clock
   * past a deadline, or to simulate a push arriving mid-sync).
   */
  onRequest: ((request: { method: string; path: string; query: URLSearchParams }) => void | Promise<void>) | null = null;

  readonly requests: { method: string; url: string; path: string }[] = [];
  readonly appRequests: { method: string; url: string; headers: Record<string, string> }[] = [];
  readonly tokenRequests: URLSearchParams[] = [];
  readonly revoked: string[] = [];
  readonly watchCalls: unknown[] = [];
  stopCalls = 0;

  private readonly messages = new Map<string, GmailMessage>();
  private readonly history: GmailHistoryRecord[] = [];
  private readonly drafts = new Map<string, string>();
  private readonly failures: Failure[] = [];
  private pageGeneration = 0;
  private counter = 0;
  private clock = Date.UTC(2026, 0, 1);
  private tokenCounter = 0;

  constructor(email = "me@example.com") {
    this.email = email;
  }

  /* ---------------------------------------------------------------- mailbox */

  addMessage(spec: FakeMessageSpec = {}, options: { record?: boolean } = {}): string {
    const id = spec.id ?? this.nextId("m");
    const message = this.buildMessage(id, spec);
    this.messages.set(id, message);
    if (options.record !== false) this.record({ messagesAdded: [{ message: this.ref(message) }] }, message);
    return id;
  }

  /** Add many simple inbound messages (oldest first). Returns their ids. */
  addMany(count: number, spec: (i: number) => FakeMessageSpec = () => ({}), options: { record?: boolean } = {}): string[] {
    return Array.from({ length: count }, (_, i) => this.addMessage(spec(i), options));
  }

  modifyLabels(id: string, add: string[], remove: string[] = []): void {
    const message = this.mustGet(id);
    const labels = new Set(message.labelIds ?? []);
    const added = add.filter((l) => !labels.has(l));
    const removed = remove.filter((l) => labels.has(l));
    for (const l of added) labels.add(l);
    for (const l of removed) labels.delete(l);
    message.labelIds = [...labels];
    if (added.length) this.record({ labelsAdded: [{ message: this.ref(message), labelIds: added }] }, message);
    if (removed.length) this.record({ labelsRemoved: [{ message: this.ref(message), labelIds: removed }] }, message);
  }

  trash(id: string): void {
    this.modifyLabels(id, ["TRASH"], ["INBOX"]);
  }

  untrash(id: string): void {
    this.modifyLabels(id, ["INBOX"], ["TRASH"]);
  }

  spam(id: string): void {
    this.modifyLabels(id, ["SPAM"], ["INBOX"]);
  }

  unspam(id: string): void {
    this.modifyLabels(id, ["INBOX"], ["SPAM"]);
  }

  deleteForever(id: string): void {
    const message = this.mustGet(id);
    this.messages.delete(id);
    this.record({ messagesDeleted: [{ message: this.ref(message) }] });
  }

  /** Change labels without a history record (e.g. between list and get). */
  setLabelsSilently(id: string, labels: string[]): void {
    this.mustGet(id).labelIds = [...labels];
  }

  /** Make every history id before the current one unusable (history.list → 404). */
  expireHistory(): void {
    this.historyFloor = this.historyId;
  }

  /** Invalidate every outstanding messages.list page token (→ 400). */
  invalidatePageTokens(): void {
    this.pageGeneration++;
  }

  has(id: string): boolean {
    return this.messages.has(id);
  }

  labelsOf(id: string): string[] {
    return [...(this.mustGet(id).labelIds ?? [])];
  }

  draftIds(): string[] {
    return [...this.drafts.keys()];
  }

  /** Make the next `times` requests matching `path` (and method) fail. */
  failNext(path: RegExp, status: number, options: { reason?: string; message?: string; times?: number; method?: string; headers?: Record<string, string> } = {}): void {
    this.failures.push({ path, status, times: options.times ?? 1, reason: options.reason, message: options.message, method: options.method, headers: options.headers });
  }

  /** Requests to the Gmail API whose path matches. */
  count(path: RegExp, method?: string): number {
    return this.requests.filter((r) => path.test(r.path) && (!method || r.method === method)).length;
  }

  /* ------------------------------------------------------------------ fetch */

  readonly fetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const bodyText = init?.body !== undefined && init?.body !== null ? String(init.body) : request ? await request.text() : "";

    if (url.href.startsWith(APP_URL)) {
      this.appRequests.push({ method, url: url.href, headers: Object.fromEntries(headers.entries()) });
      return new Response(JSON.stringify({ accepted: true }), { status: this.appStatus });
    }
    if (url.href === TOKEN_URL) return this.token(new URLSearchParams(bodyText));
    if (url.href === REVOKE_URL) {
      this.revoked.push(new URLSearchParams(bodyText).get("token") ?? "");
      return json(200, {});
    }
    if (!url.href.startsWith(GMAIL_PREFIX)) throw new Error(`FakeGmail: unexpected request to ${url.href}`);

    const path = url.pathname.slice("/gmail/v1/users/me/".length);
    this.requests.push({ method, url: url.href, path });
    if (!/^Bearer\s+\S+/.test(headers.get("authorization") ?? "")) return gmailError(401, "Login Required");

    const failure = this.failures.find((f) => f.path.test(path) && (!f.method || f.method === method));
    if (failure) {
      failure.times--;
      if (failure.times <= 0) this.failures.splice(this.failures.indexOf(failure), 1);
      const response = gmailError(failure.status, failure.message ?? `Injected failure ${failure.status}`, failure.reason);
      if (failure.headers) for (const [k, v] of Object.entries(failure.headers)) response.headers.set(k, v);
      return response;
    }

    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
    const response = this.route(method, path, url.searchParams, body);
    await this.onRequest?.({ method, path, query: url.searchParams });
    return response;
  };

  /* ---------------------------------------------------------------- routing */

  private route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Response {
    if (method === "GET" && path === "profile") {
      return json(200, {
        emailAddress: this.email,
        messagesTotal: this.messagesTotalOverride ?? this.messages.size,
        threadsTotal: new Set([...this.messages.values()].map((m) => m.threadId)).size,
        historyId: String(this.historyId),
      });
    }
    if (method === "GET" && path === "messages") return this.listMessages(query);
    let match = /^messages\/([^/]+)$/.exec(path);
    if (method === "GET" && match) {
      const message = this.messages.get(decodeURIComponent(match[1]));
      if (!message) return gmailError(404, "Requested entity was not found.", "notFound");
      return json(200, this.format(message, query.get("format") ?? "full"));
    }
    if (method === "GET" && path === "history") return this.listHistory(query);
    if (method === "POST" && path === "watch") {
      this.watchCalls.push(body);
      return json(200, { historyId: String(this.historyId), expiration: String(Date.now() + 7 * 86_400_000) });
    }
    if (method === "POST" && path === "stop") {
      this.stopCalls++;
      return json(204, null);
    }
    if (method === "GET" && path === "settings/sendAs") return json(200, { sendAs: this.sendAs });

    if (method === "POST" && path === "drafts") {
      const message = body.message as { raw: string; threadId?: string };
      const draftId = this.nextId("r");
      const created = this.messageFromRaw(message.raw, message.threadId, ["DRAFT"]);
      this.drafts.set(draftId, created.id);
      return json(200, { id: draftId, message: this.ref(created) });
    }
    if (method === "GET" && path === "drafts") {
      const max = Number(query.get("maxResults") ?? 100);
      const drafts = [...this.drafts.entries()]
        .reverse()
        .slice(0, max)
        .map(([id, messageId]) => ({ id, message: this.ref(this.mustGet(messageId)) }));
      return json(200, { drafts, resultSizeEstimate: this.drafts.size });
    }
    if (method === "POST" && path === "drafts/send") {
      const draftId = String(body.id ?? "");
      const messageId = this.drafts.get(draftId);
      if (!messageId) return gmailError(404, "Requested entity was not found.", "notFound");
      const draft = this.mustGet(messageId);
      this.drafts.delete(draftId);
      this.messages.delete(messageId);
      this.record({ messagesDeleted: [{ message: this.ref(draft) }] });
      const sentId = this.nextId("m");
      const sent: GmailMessage = { ...clone(draft), id: sentId, labelIds: ["SENT"], internalDate: String(this.tick()) };
      this.messages.set(sentId, sent);
      this.record({ messagesAdded: [{ message: this.ref(sent) }] }, sent);
      return json(200, this.ref(sent));
    }
    match = /^drafts\/([^/]+)$/.exec(path);
    if (match) {
      const draftId = decodeURIComponent(match[1]);
      const messageId = this.drafts.get(draftId);
      if (!messageId) return gmailError(404, "Requested entity was not found.", "notFound");
      if (method === "GET") {
        return json(200, { id: draftId, message: this.format(this.mustGet(messageId), query.get("format") ?? "full") });
      }
      if (method === "DELETE") {
        const draft = this.mustGet(messageId);
        this.drafts.delete(draftId);
        this.messages.delete(messageId);
        this.record({ messagesDeleted: [{ message: this.ref(draft) }] });
        return json(204, null);
      }
      if (method === "PUT") {
        const message = body.message as { raw: string; threadId?: string };
        const old = this.mustGet(messageId);
        this.messages.delete(messageId);
        this.record({ messagesDeleted: [{ message: this.ref(old) }] });
        const updated = this.messageFromRaw(message.raw, message.threadId, ["DRAFT"]);
        this.drafts.set(draftId, updated.id);
        return json(200, { id: draftId, message: this.ref(updated) });
      }
    }
    return gmailError(404, `FakeGmail: no route for ${method} ${path}`);
  }

  private listMessages(query: URLSearchParams): Response {
    const includeSpamTrash = query.get("includeSpamTrash") === "true" || this.listIncludesEverything;
    const after = /(?:^|\s)after:(\d+)(?:\s|$)/.exec(query.get("q") ?? "");
    const all = [...this.messages.values()]
      .filter((m) => includeSpamTrash || !(m.labelIds ?? []).some((l) => l === "SPAM" || l === "TRASH"))
      .filter((m) => !after || Number(m.internalDate) / 1000 > Number(after[1]))
      .sort((a, b) => Number(b.internalDate) - Number(a.internalDate) || (a.id < b.id ? 1 : -1));
    let offset = 0;
    const token = query.get("pageToken");
    if (token) {
      const parsed = /^g(\d+):(\d+)$/.exec(token);
      if (!parsed || Number(parsed[1]) !== this.pageGeneration) return gmailError(400, "Invalid pageToken", "invalidArgument");
      offset = Number(parsed[2]);
    }
    const size = Math.min(Number(query.get("maxResults") ?? 100), this.listPageSize);
    const slice = all.slice(offset, offset + size);
    const next = offset + size < all.length ? `g${this.pageGeneration}:${offset + size}` : undefined;
    return json(200, {
      ...(slice.length ? { messages: slice.map((m) => ({ id: m.id, threadId: m.threadId })) } : {}),
      ...(next ? { nextPageToken: next } : {}),
      resultSizeEstimate: all.length,
    });
  }

  private listHistory(query: URLSearchParams): Response {
    const start = Number(query.get("startHistoryId"));
    if (!Number.isFinite(start) || start < this.historyFloor) return gmailError(404, "Requested entity was not found.", "notFound");
    const records = this.history.filter((r) => Number(r.id) > start);
    const offset = Number(query.get("pageToken") ?? 0) || 0;
    const size = Math.min(Number(query.get("maxResults") ?? 500), this.historyPageSize);
    const slice = records.slice(offset, offset + size);
    const next = offset + size < records.length ? String(offset + size) : undefined;
    return json(200, {
      ...(slice.length ? { history: clone(slice) } : {}),
      ...(next ? { nextPageToken: next } : {}),
      historyId: String(this.historyId),
    });
  }

  private token(params: URLSearchParams): Response {
    this.tokenRequests.push(params);
    const grant = params.get("grant_type");
    if (grant === "refresh_token") {
      if (this.refreshError) return json(400, { error: this.refreshError, error_description: "Token has been expired or revoked." });
      return json(200, { access_token: `fresh-${++this.tokenCounter}`, expires_in: 3599, scope: this.scope, token_type: "Bearer" });
    }
    if (grant === "authorization_code") {
      if (params.get("code") !== "good-code") return json(400, { error: "invalid_grant", error_description: "Bad code" });
      const idPayload = b64url(JSON.stringify({ email: this.email, name: "Me Myself" }));
      return json(200, {
        access_token: `code-${++this.tokenCounter}`,
        expires_in: 3599,
        scope: this.scope,
        token_type: "Bearer",
        id_token: `e30.${idPayload}.sig`,
        ...(this.codeRefreshToken ? { refresh_token: this.codeRefreshToken } : {}),
      });
    }
    return json(400, { error: "unsupported_grant_type" });
  }

  /* ---------------------------------------------------------------- helpers */

  private nextId(prefix: string): string {
    this.counter++;
    return `${prefix}${String(this.counter).padStart(6, "0")}`;
  }

  private tick(): number {
    this.clock += 60_000;
    return this.clock;
  }

  private mustGet(id: string): GmailMessage {
    const message = this.messages.get(id);
    if (!message) throw new Error(`FakeGmail: no message ${id}`);
    return message;
  }

  private ref(message: GmailMessage): GmailMessageRef {
    return { id: message.id, threadId: message.threadId, labelIds: [...(message.labelIds ?? [])] };
  }

  private record(change: Omit<GmailHistoryRecord, "id" | "messages">, message?: GmailMessage): void {
    this.historyId++;
    if (message) message.historyId = String(this.historyId);
    this.history.push({ id: String(this.historyId), ...clone(change) });
  }

  private format(message: GmailMessage, format: string): GmailMessage {
    const copy = clone(message);
    if (format === "minimal") delete copy.payload;
    else if (format === "metadata" && copy.payload) copy.payload = { mimeType: copy.payload.mimeType, headers: copy.payload.headers };
    return copy;
  }

  private buildMessage(id: string, spec: FakeMessageSpec): GmailMessage {
    const date = spec.date === undefined ? this.tick() : typeof spec.date === "number" ? spec.date : spec.date.getTime();
    const headers: GmailHeader[] = [];
    const add = (name: string, value: string | undefined) => {
      if (value !== undefined) headers.push({ name, value });
    };
    add("From", spec.from ?? "Sender <sender@example.org>");
    add("To", spec.to ?? this.email);
    add("Cc", spec.cc);
    add("Bcc", spec.bcc);
    add("Reply-To", spec.replyTo);
    add("Subject", spec.subject ?? `Subject ${id}`);
    add("Message-ID", spec.messageId ?? `<${id}@fake.example>`);
    add("In-Reply-To", spec.inReplyTo);
    add("References", spec.references);
    add("Date", new Date(date).toUTCString());
    for (const [name, value] of Object.entries(spec.headers ?? {})) add(name, value);
    const body = spec.body ?? `Hello from ${id}`;
    return {
      id,
      threadId: spec.threadId ?? `t-${id}`,
      labelIds: spec.labels ?? ["INBOX", "UNREAD"],
      snippet: body.slice(0, 100),
      internalDate: String(date),
      sizeEstimate: body.length + 200,
      payload: {
        mimeType: "text/plain",
        headers,
        body: { size: Buffer.byteLength(body), data: b64url(body) },
      },
    };
  }

  private messageFromRaw(raw: string, threadId: string | undefined, labels: string[]): GmailMessage {
    const text = Buffer.from(raw, "base64url").toString("utf8");
    const split = text.indexOf("\r\n\r\n");
    const head = split === -1 ? text : text.slice(0, split);
    const encodedBody = split === -1 ? "" : text.slice(split + 4);
    const headers: GmailHeader[] = [];
    for (const line of head.split("\r\n")) {
      if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1].value += ` ${line.trim()}`;
      else {
        const colon = line.indexOf(":");
        if (colon > 0) headers.push({ name: line.slice(0, colon), value: line.slice(colon + 1).trim() });
      }
    }
    const base64 = headers.some((h) => h.name.toLowerCase() === "content-transfer-encoding" && /base64/i.test(h.value));
    const body = base64 ? Buffer.from(encodedBody.replace(/\s+/g, ""), "base64").toString("utf8") : encodedBody;
    const id = this.nextId("m");
    const message: GmailMessage = {
      id,
      threadId: threadId ?? `t-${id}`,
      labelIds: labels,
      snippet: body.slice(0, 100),
      internalDate: String(this.tick()),
      payload: { mimeType: "text/plain", headers, body: { size: Buffer.byteLength(body), data: b64url(body) } },
    };
    this.messages.set(id, message);
    this.record({ messagesAdded: [{ message: this.ref(message) }] }, message);
    return message;
  }
}
