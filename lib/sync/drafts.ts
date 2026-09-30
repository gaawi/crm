import "server-only";
import { sql } from "@/lib/db";
import { buildRawMessage, replySubject } from "@/lib/gmail/mime";
import { canCompose } from "@/lib/gmail/oauth";
import { decodeMimeWords, getHeader, parseAddressList, parseGmailMessage } from "@/lib/gmail/parse";
import type { GmailClient } from "@/lib/gmail/client";
import type { Address } from "@/lib/types";
import { getAccount, getSelfEmails, gmailClientFor, type GmailAccountRecord } from "@/lib/sync/accounts";
import { ingestMessages } from "@/lib/sync/ingest";
import { isValidEmail } from "@/lib/utils";

/**
 * Gmail drafts in connected accounts. The CRM saves drafts for the owner to
 * review; only sendGmailDraft (the approval queue's "Approve") sends.
 * Every function accepts an optional `fetchImpl` (tests).
 */

type FetchOption = { fetchImpl?: typeof fetch };

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

/** Opens the draft in Gmail, in the right signed-in account. */
export function gmailDraftUrl(accountEmail: string, gmailMessageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#drafts?compose=${encodeURIComponent(gmailMessageId)}`;
}

async function composeAccount(accountId: string): Promise<GmailAccountRecord> {
  const account = await getAccount(accountId);
  if (!account) throw new DraftError("Gmail account not found");
  if (account.status !== "active" || !canCompose(account.scopes)) {
    throw new DraftError(`Reconnect ${account.email} to allow drafts`);
  }
  return account;
}

function recipients(values: readonly string[] | undefined, field: string): Address[] {
  const out: Address[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const email = String(value ?? "").trim().toLowerCase();
    if (!email) continue;
    if (!isValidEmail(email)) throw new DraftError(`Invalid ${field} address: ${value}`);
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: null });
  }
  return out;
}

interface ReplyContext {
  threadId: string | undefined;
  inReplyTo: string | null;
  references: string | null;
  subject: string | null;
}

/**
 * Thread and headers for a reply to messages.id `replyToMessageId`: the Gmail
 * thread is reused only when the message (or a copy with the same Message-ID)
 * belongs to this account.
 */
async function replyContext(accountId: string, replyToMessageId: string | null | undefined): Promise<ReplyContext | null> {
  if (!replyToMessageId) return null;
  if (!/^[0-9a-f-]{36}$/i.test(replyToMessageId)) throw new DraftError("The message to reply to was not found");
  const [message] = await sql<
    { accountId: string; gmailThreadId: string; rfc822MessageId: string | null; referencesHeader: string | null; subject: string | null }[]
  >`
    select account_id, gmail_thread_id, rfc822_message_id, references_header, subject
      from messages where id = ${replyToMessageId}
  `;
  if (!message) throw new DraftError("The message to reply to was not found");
  let threadId: string | undefined = message.accountId === accountId ? message.gmailThreadId : undefined;
  if (!threadId && message.rfc822MessageId) {
    const [copy] = await sql<{ gmailThreadId: string }[]>`
      select gmail_thread_id from messages
       where account_id = ${accountId} and rfc822_message_id = ${message.rfc822MessageId}
       order by sent_at desc limit 1
    `;
    threadId = copy?.gmailThreadId;
  }
  return {
    threadId,
    inReplyTo: message.rfc822MessageId,
    references: message.referencesHeader,
    subject: message.subject,
  };
}

async function buildDraft(
  account: GmailAccountRecord,
  params: { to: string[]; cc?: string[]; subject: string; body: string; replyToMessageId?: string | null },
): Promise<{ raw: string; threadId: string | undefined }> {
  const to = recipients(params.to, "To");
  const cc = recipients(params.cc, "Cc").filter((a) => !to.some((t) => t.email === a.email));
  if (to.length === 0) throw new DraftError("A draft needs at least one recipient");
  const reply = await replyContext(account.id, params.replyToMessageId);
  const given = String(params.subject ?? "").trim();
  const subject = given || (reply ? replySubject(reply.subject) : "");
  const raw = buildRawMessage({
    from: { email: account.email, name: account.displayName },
    to,
    cc,
    subject,
    bodyText: String(params.body ?? ""),
    inReplyTo: reply?.inReplyTo ?? null,
    references: reply?.references ?? null,
  });
  return { raw, threadId: reply?.threadId };
}

/**
 * Save an email as a Gmail draft in a connected account (never sends).
 * When replyToMessageId is given (a messages.id), the draft replies in that
 * message's thread: same Gmail threadId (only if the message belongs to the
 * same account; otherwise a new thread), In-Reply-To/References headers, and
 * "Re: <subject>" unless a subject is given. From = the account's address.
 * Returns the draft id and a URL that opens it in Gmail.
 */
export async function saveGmailDraft(
  params: {
    accountId: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    replyToMessageId?: string | null;
  } & FetchOption,
): Promise<{ draftId: string; gmailUrl: string }> {
  const account = await composeAccount(params.accountId);
  const { raw, threadId } = await buildDraft(account, params);
  const draft = await gmailClientFor(account.id, params.fetchImpl).createDraft({ raw, threadId });
  return { draftId: draft.id, gmailUrl: gmailDraftUrl(account.email, draft.message?.id ?? draft.id) };
}

/** Replace the content of an existing Gmail draft (drafts.update), keeping its thread. */
export async function updateGmailDraft(
  params: {
    accountId: string;
    draftId: string;
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    replyToMessageId?: string | null;
  } & FetchOption,
): Promise<{ draftId: string; gmailUrl: string }> {
  const account = await composeAccount(params.accountId);
  const { raw, threadId } = await buildDraft(account, params);
  const client = gmailClientFor(account.id, params.fetchImpl);
  let thread = threadId;
  if (!thread) {
    const existing = await client.getDraft(params.draftId, "minimal");
    if (!existing) throw new DraftError("The Gmail draft no longer exists");
    thread = existing.message?.threadId || undefined;
  }
  const draft = await client.updateDraft({ id: params.draftId, raw, threadId: thread });
  return { draftId: draft.id, gmailUrl: gmailDraftUrl(account.email, draft.message?.id ?? draft.id) };
}

/**
 * Store the sent message right away so it shows in the CRM before the next
 * sync (best effort: the next sync stores it otherwise).
 */
async function ingestSent(client: GmailClient, accountId: string, gmailMessageId: string): Promise<void> {
  try {
    const message = await client.getMessage(gmailMessageId);
    if (!message) return;
    const selfEmails = await getSelfEmails();
    await ingestMessages(accountId, [parseGmailMessage(message, { selfEmails })], selfEmails);
  } catch (error) {
    console.warn(`Could not store sent message ${gmailMessageId}:`, error);
  }
}

/** Send an existing Gmail draft (drafts.send). Returns the sent message's Gmail ids. */
export async function sendGmailDraft(
  accountId: string,
  draftId: string,
  options: FetchOption = {},
): Promise<{ gmailMessageId: string; gmailThreadId: string }> {
  const account = await composeAccount(accountId);
  const client = gmailClientFor(account.id, options.fetchImpl);
  const sent = await client.sendDraft(draftId);
  await ingestSent(client, account.id, sent.id);
  return { gmailMessageId: sent.id, gmailThreadId: sent.threadId };
}

/** Delete a Gmail draft (drafts.delete) — best effort, never throws on 404. */
export async function deleteGmailDraft(accountId: string, draftId: string, options: FetchOption = {}): Promise<void> {
  const account = await composeAccount(accountId);
  await gmailClientFor(account.id, options.fetchImpl).deleteDraft(draftId);
}

/** Drafts currently in the account's Gmail (drafts.list + metadata), newest first. */
export async function listGmailDrafts(
  accountId: string,
  options: { limit?: number } & FetchOption = {},
): Promise<
  { draftId: string; gmailMessageId: string; gmailThreadId: string; to: string[]; subject: string; snippet: string; updatedAt: Date | null }[]
> {
  const account = await getAccount(accountId);
  if (!account) throw new DraftError("Gmail account not found");
  if (account.status !== "active") throw new DraftError(`Reconnect ${account.email} to see its drafts`);
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 25)));
  const client = gmailClientFor(account.id, options.fetchImpl);
  const list = await client.listDrafts({ maxResults: limit });
  const refs = (list.drafts ?? []).slice(0, limit);

  const details = await Promise.all(refs.map((ref) => client.getDraft(ref.id, "metadata")));
  const out = details
    .filter((d): d is NonNullable<typeof d> => d !== null && Boolean(d.message))
    .map((draft) => {
      const headers = draft.message.payload?.headers;
      const internal = Number(draft.message.internalDate);
      return {
        draftId: draft.id,
        gmailMessageId: draft.message.id,
        gmailThreadId: draft.message.threadId,
        to: parseAddressList(getHeader(headers, "To")).map((a) => a.email),
        subject: decodeMimeWords(getHeader(headers, "Subject") ?? "").replace(/\s+/g, " ").trim(),
        snippet: draft.message.snippet ?? "",
        updatedAt: Number.isFinite(internal) && internal > 0 ? new Date(internal) : null,
      };
    });
  out.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  return out;
}
