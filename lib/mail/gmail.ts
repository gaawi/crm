import "server-only";
import { sql } from "@/lib/db";
import { GmailApiError, type GmailClient } from "@/lib/gmail/client";
import { buildRawMessage } from "@/lib/gmail/mime";
import { canCompose, canModify } from "@/lib/gmail/oauth";
import { decodeMimeWords, extractBodies, getHeader, parseAddressList, parseGmailMessage, stripQuotedText } from "@/lib/gmail/parse";
import type { GmailLabel, GmailMessage, GmailMessagePart, GmailThread } from "@/lib/gmail/types";
import { applyLabelChange } from "@/lib/mail/queries";
import { normalizeContentId, sanitizeEmailHtml } from "@/lib/mail/sanitize";
import { getAccount, getSelfEmails, gmailClientFor, type GmailAccountRecord } from "@/lib/sync/accounts";
import { ingestMessages, updateMessageLabels } from "@/lib/sync/ingest";
import type { Address } from "@/lib/types";
import { isValidEmail } from "@/lib/utils";

/**
 * Live Gmail operations for the mail client: open a thread (full HTML,
 * attachments, inline images), change labels, trash, send. Every change is
 * applied to the stored copy right away so lists are consistent before the
 * next sync. Nothing here deletes mail permanently.
 */

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailError";
  }
}

type Need = "read" | "modify" | "send";

async function mailAccount(accountId: string, need: Need): Promise<GmailAccountRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new MailError("Gmail account not found");
  const account = await getAccount(accountId);
  if (!account) throw new MailError("Gmail account not found");
  if (account.status !== "active") throw new MailError(`Reconnect ${account.email} in Settings`);
  if (need === "modify" && !canModify(account.scopes)) throw new MailError(`Reconnect ${account.email} to allow changes`);
  if (need === "send" && !canCompose(account.scopes)) throw new MailError(`Reconnect ${account.email} to allow sending`);
  return account;
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                  */
/* ------------------------------------------------------------------------ */

const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGES = 20;
const MAX_MIME_DEPTH = 30;

export interface LiveAttachment {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface LiveMessage {
  gmailMessageId: string;
  threadId: string;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
  outbound: boolean;
  from: Address | null;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  date: Date;
  subject: string | null;
  snippet: string;
  /** Sanitized HTML body (render with buildSrcDoc in a sandboxed iframe), or null. */
  html: string | null;
  /** Remote images removed from the HTML. */
  remoteImages: number;
  /** Plain-text body (from text/plain, else converted from HTML). */
  text: string | null;
  /** The text without quoted history (for the collapsed "show quoted" view and for Claude). */
  textWithoutQuotes: string | null;
  attachments: LiveAttachment[];
  rfc822MessageId: string | null;
  references: string | null;
}

export interface LiveThread {
  accountId: string;
  accountEmail: string;
  threadId: string;
  subject: string | null;
  labelIds: string[];
  messages: LiveMessage[];
}

interface PartInfo {
  part: GmailMessagePart;
  partId: string;
  mimeType: string;
  filename: string;
  contentId: string | null;
}

function walkParts(payload: GmailMessagePart | undefined): PartInfo[] {
  const out: PartInfo[] = [];
  const visit = (part: GmailMessagePart | undefined, depth: number) => {
    if (!part || depth > MAX_MIME_DEPTH) return;
    const contentId = getHeader(part.headers, "Content-ID");
    out.push({
      part,
      partId: part.partId ?? "",
      mimeType: (part.mimeType ?? "").toLowerCase(),
      filename: part.filename ? decodeMimeWords(part.filename).trim() : "",
      contentId: contentId ? normalizeContentId(contentId) : null,
    });
    for (const child of part.parts ?? []) visit(child, depth + 1);
  };
  visit(payload, 0);
  return out;
}

function base64UrlToBase64(data: string): string {
  return data.replace(/-/g, "+").replace(/_/g, "/");
}

/** data: URIs for the cid: images the HTML references (≤ 2 MB each). */
async function inlineImages(client: GmailClient, message: GmailMessage, html: string, parts: PartInfo[]): Promise<Map<string, string>> {
  const referenced = new Set<string>();
  for (const match of html.matchAll(/cid:([^"'\s)>]+)/gi)) referenced.add(normalizeContentId(decodeURIComponent(match[1])));
  const map = new Map<string, string>();
  if (!referenced.size) return map;

  const wanted = parts
    .filter((p) => p.contentId && referenced.has(p.contentId) && p.mimeType.startsWith("image/"))
    .filter((p) => (p.part.body?.size ?? 0) <= MAX_INLINE_IMAGE_BYTES)
    .slice(0, MAX_INLINE_IMAGES);

  await Promise.all(
    wanted.map(async (p) => {
      let data = p.part.body?.data ?? null;
      if (!data && p.part.body?.attachmentId) {
        try {
          data = (await client.getAttachment(message.id, p.part.body.attachmentId))?.data ?? null;
        } catch {
          data = null;
        }
      }
      if (data && p.contentId) {
        const mime = /^image\/(png|gif|jpe?g|webp|bmp|avif)$/.test(p.mimeType) ? p.mimeType : "image/png";
        map.set(p.contentId, `data:${mime};base64,${base64UrlToBase64(data)}`);
      }
    }),
  );
  return map;
}

async function toLiveMessage(client: GmailClient, message: GmailMessage, selfEmails: ReadonlySet<string>): Promise<LiveMessage> {
  const headers = message.payload?.headers;
  const labelIds = message.labelIds ?? [];
  const from = parseAddressList(getHeader(headers, "From"))[0] ?? null;
  const parts = walkParts(message.payload);
  const bodies = extractBodies(message.payload);

  let html: string | null = null;
  let remoteImages = 0;
  if (bodies.html) {
    const images = await inlineImages(client, message, bodies.html, parts);
    const sanitized = sanitizeEmailHtml(bodies.html, { inlineImages: images });
    html = sanitized.html;
    remoteImages = sanitized.remoteImages;
  }
  const referencedCids = new Set<string>();
  if (bodies.html) for (const match of bodies.html.matchAll(/cid:([^"'\s)>]+)/gi)) referencedCids.add(normalizeContentId(match[1]));

  const text = bodies.text ?? (bodies.html ? parseGmailMessage(message, { selfEmails }).bodyText : null);
  const internal = Number(message.internalDate);
  const date = Number.isFinite(internal) && internal > 0 ? new Date(internal) : new Date(getHeader(headers, "Date") ?? Date.now());

  return {
    gmailMessageId: message.id,
    threadId: message.threadId,
    labelIds,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    outbound: labelIds.includes("SENT") || Boolean(from && selfEmails.has(from.email)),
    from,
    to: parseAddressList(getHeader(headers, "To")),
    cc: parseAddressList(getHeader(headers, "Cc")),
    replyTo: parseAddressList(getHeader(headers, "Reply-To")),
    date: Number.isNaN(date.getTime()) ? new Date() : date,
    subject: getHeader(headers, "Subject") !== null ? decodeMimeWords(getHeader(headers, "Subject") ?? "") : null,
    snippet: message.snippet ?? "",
    html,
    remoteImages,
    text,
    textWithoutQuotes: text ? stripQuotedText(text) : null,
    attachments: parts
      .filter((p) => p.filename && (p.part.body?.attachmentId || p.part.body?.data))
      .filter((p) => !(p.contentId && referencedCids.has(p.contentId)))
      .map((p) => ({ partId: p.partId, filename: p.filename, mimeType: p.mimeType || "application/octet-stream", size: p.part.body?.size ?? 0 })),
    rfc822MessageId: getHeader(headers, "Message-ID") ?? getHeader(headers, "Message-Id"),
    references: getHeader(headers, "References"),
  };
}

const HIDDEN_LABELS = new Set(["DRAFT", "SPAM", "CHAT"]);

/** The full thread from Gmail, or null if it no longer exists there. Drafts and spam are left out. */
export async function fetchThread(accountId: string, threadId: string): Promise<LiveThread | null> {
  const account = await mailAccount(accountId, "read");
  const client = gmailClientFor(account.id);
  const thread = await client.getThread(threadId, "full");
  if (!thread?.messages?.length) return null;
  const selfEmails = await getSelfEmails();
  const visible = thread.messages.filter((m) => !(m.labelIds ?? []).some((l) => HIDDEN_LABELS.has(l)));
  if (!visible.length) return null;
  const messages = await Promise.all(visible.map((m) => toLiveMessage(client, m, selfEmails)));
  messages.sort((a, b) => a.date.getTime() - b.date.getTime());
  const labelIds = [...new Set(messages.flatMap((m) => m.labelIds))].sort();
  return {
    accountId: account.id,
    accountEmail: account.email,
    threadId,
    subject: messages.find((m) => m.subject?.trim())?.subject ?? null,
    labelIds,
    messages,
  };
}

/** One attachment's bytes (looked up by MIME part id, since attachment ids are not stable). */
export async function fetchAttachment(
  accountId: string,
  gmailMessageId: string,
  partId: string,
): Promise<{ filename: string; mimeType: string; data: Buffer } | null> {
  const account = await mailAccount(accountId, "read");
  const client = gmailClientFor(account.id);
  const message = await client.getMessage(gmailMessageId, "full");
  if (!message) return null;
  const part = walkParts(message.payload).find((p) => p.partId === partId);
  if (!part) return null;
  let data = part.part.body?.data ?? null;
  if (!data && part.part.body?.attachmentId) {
    data = (await client.getAttachment(message.id, part.part.body.attachmentId))?.data ?? null;
  }
  if (data === null) return null;
  return {
    filename: part.filename || "attachment",
    mimeType: part.mimeType || "application/octet-stream",
    data: Buffer.from(data, "base64url"),
  };
}

/* ------------------------------------------------------------------------ */
/* Labels                                                                   */
/* ------------------------------------------------------------------------ */

const LABEL_TTL_MS = 5 * 60_000;
const labelCache = new Map<string, { at: number; labels: GmailLabel[] }>();

/** labels.list for an account (cached for 5 minutes per server instance). */
export async function listLabels(accountId: string, options: { fresh?: boolean } = {}): Promise<GmailLabel[]> {
  const cached = labelCache.get(accountId);
  if (!options.fresh && cached && Date.now() - cached.at < LABEL_TTL_MS) return cached.labels;
  const account = await mailAccount(accountId, "read");
  const labels = await gmailClientFor(account.id).listLabels();
  labelCache.set(accountId, { at: Date.now(), labels });
  return labels;
}

export interface UserLabel {
  id: string;
  name: string;
  accountId: string;
  color: string | null;
}

/** User labels of every given account; failures (e.g. revoked access) are skipped. */
export async function userLabels(accountIds: string[]): Promise<UserLabel[]> {
  const lists = await Promise.all(
    accountIds.map(async (accountId) => {
      try {
        return (await listLabels(accountId))
          .filter((l) => l.type === "user" && l.labelListVisibility !== "labelHide")
          .map((l) => ({ id: l.id, name: l.name, accountId, color: l.color?.backgroundColor ?? null }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------------ */
/* Changes                                                                  */
/* ------------------------------------------------------------------------ */

export type ThreadAction = "archive" | "inbox" | "trash" | "untrash" | "read" | "unread" | "star" | "unstar";

/** Store Gmail's resulting labels when it returned them; otherwise apply the change locally. */
async function storeThreadLabels(accountId: string, threadId: string, thread: GmailThread | null, add: string[], remove: string[]) {
  const withLabels = (thread?.messages ?? []).filter((m) => Array.isArray(m.labelIds));
  if (withLabels.length) {
    await updateMessageLabels(
      accountId,
      withLabels.map((m) => ({ gmailMessageId: m.id, labelIds: m.labelIds ?? [] })),
    );
  } else {
    await applyLabelChange({ accountId, threadId, add, remove });
  }
}

async function latestMessageId(accountId: string, threadId: string): Promise<string | null> {
  const [row] = await sql<{ gmailMessageId: string }[]>`
    select gmail_message_id from messages
     where account_id = ${accountId} and gmail_thread_id = ${threadId}
       and not (label_ids && '{TRASH,SPAM,DELETED}')
     order by sent_at desc limit 1
  `;
  return row?.gmailMessageId ?? null;
}

export async function applyThreadAction(accountId: string, threadId: string, action: ThreadAction): Promise<void> {
  const account = await mailAccount(accountId, "modify");
  const client = gmailClientFor(account.id);
  try {
    switch (action) {
      case "trash": {
        const thread = await client.trashThread(threadId);
        await storeThreadLabels(account.id, threadId, thread, ["TRASH"], ["INBOX", "UNREAD"]);
        return;
      }
      case "untrash": {
        const thread = await client.untrashThread(threadId);
        await storeThreadLabels(account.id, threadId, thread, [], ["TRASH"]);
        return;
      }
      case "star": {
        // Like Gmail: the star goes on the latest message.
        const id = (await latestMessageId(account.id, threadId)) ?? (await client.getThread(threadId, "minimal"))?.messages?.at(-1)?.id;
        if (!id) throw new MailError("This conversation no longer exists");
        await client.batchModifyMessages([id], { addLabelIds: ["STARRED"] });
        await applyLabelChange({ accountId: account.id, threadId, messageIds: [id], add: ["STARRED"] });
        return;
      }
      default: {
        const change: Record<Exclude<ThreadAction, "trash" | "untrash" | "star">, { add: string[]; remove: string[] }> = {
          archive: { add: [], remove: ["INBOX"] },
          inbox: { add: ["INBOX"], remove: [] },
          read: { add: [], remove: ["UNREAD"] },
          unread: { add: ["UNREAD"], remove: [] },
          unstar: { add: [], remove: ["STARRED"] },
        };
        const { add, remove } = change[action];
        const thread = await client.modifyThread(threadId, { addLabelIds: add, removeLabelIds: remove });
        await storeThreadLabels(account.id, threadId, thread, add, remove);
      }
    }
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 404) throw new MailError("This conversation no longer exists in Gmail");
    throw error;
  }
}

/** Add/remove user labels on a thread. */
export async function changeThreadLabels(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  const account = await mailAccount(accountId, "modify");
  const safe = (ids: string[]) => ids.filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
  const thread = await gmailClientFor(account.id).modifyThread(threadId, { addLabelIds: safe(add), removeLabelIds: safe(remove) });
  await storeThreadLabels(account.id, threadId, thread, safe(add), safe(remove));
}

/* ------------------------------------------------------------------------ */
/* Sending                                                                  */
/* ------------------------------------------------------------------------ */

export interface SendInput {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Gmail message id being replied to (same account): keeps the thread and headers. */
  replyToGmailMessageId?: string | null;
}

const MAX_RECIPIENTS = 100;

function addresses(values: readonly string[] | undefined, field: string, seen: Set<string>): Address[] {
  const out: Address[] = [];
  for (const raw of values ?? []) {
    for (const parsed of parseAddressList(raw)) {
      const email = parsed.email.trim().toLowerCase();
      if (!isValidEmail(email)) throw new MailError(`Invalid ${field} address: ${raw}`);
      if (seen.has(email)) continue;
      seen.add(email);
      out.push({ email, name: parsed.name });
    }
  }
  return out;
}

/** Send an email the owner wrote (the composer's Send button). Returns the sent message ids. */
export async function sendMail(input: SendInput): Promise<{ gmailMessageId: string; threadId: string }> {
  const account = await mailAccount(input.accountId, "send");
  const client = gmailClientFor(account.id);
  const seen = new Set<string>();
  const to = addresses(input.to, "To", seen);
  const cc = addresses(input.cc, "Cc", seen);
  const bcc = addresses(input.bcc, "Bcc", seen);
  if (!to.length && !cc.length && !bcc.length) throw new MailError("Add at least one recipient");
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw new MailError(`At most ${MAX_RECIPIENTS} recipients`);

  let threadId: string | undefined;
  let inReplyTo: string | null = null;
  let references: string | null = null;
  if (input.replyToGmailMessageId) {
    const original = await client.getMessage(input.replyToGmailMessageId, "metadata");
    if (!original) throw new MailError("The message you are replying to no longer exists");
    threadId = original.threadId;
    inReplyTo = getHeader(original.payload?.headers, "Message-ID");
    references = getHeader(original.payload?.headers, "References");
  }

  const raw = buildRawMessage({
    from: { email: account.email, name: account.displayName },
    to,
    cc,
    bcc,
    subject: input.subject.trim(),
    bodyText: input.body,
    inReplyTo,
    references,
  });
  const sent = await client.sendMessage({ raw, threadId });

  // Store it right away (best effort; the next sync would store it anyway).
  try {
    const message = await client.getMessage(sent.id, "full");
    if (message) {
      const selfEmails = await getSelfEmails();
      await ingestMessages(account.id, [parseGmailMessage(message, { selfEmails })], selfEmails);
    }
  } catch (error) {
    console.warn(`Could not store sent message ${sent.id}:`, error);
  }
  return { gmailMessageId: sent.id, threadId: sent.threadId };
}
