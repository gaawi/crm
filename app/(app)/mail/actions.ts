"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { draftErrorMessage } from "@/lib/ai/draft";
import { summarizeThread, writeEmailWithClaude, type ThreadSummaryResult } from "@/lib/ai/mail";
import { DraftError, proposeEmail } from "@/lib/ai/approvals";
import { sql } from "@/lib/db";
import { GmailApiError } from "@/lib/gmail/client";
import { canModify } from "@/lib/gmail/oauth";
import { applyThreadAction, archiveAllInbox, changeThreadLabels, MailError, sendMail, type ThreadAction } from "@/lib/mail/gmail";
import { countInboxThreads } from "@/lib/mail/queries";
import { likePattern } from "@/lib/queries/shared";
import { AccountAuthError, getAccount, listAccounts } from "@/lib/sync/accounts";
import { errorMessage } from "@/lib/utils";

/**
 * Server actions of the mail client. Every action checks the session and
 * validates its input; Gmail is the source of truth and the stored copy is
 * updated right away.
 */

export type MailResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const gmailId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const threadRef = z.object({ accountId: uuid, threadId: gmailId });
const actions = ["archive", "inbox", "trash", "untrash", "read", "unread", "star", "unstar"] as const satisfies readonly ThreadAction[];

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof MailError || error instanceof AccountAuthError || error instanceof DraftError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof GmailApiError) {
    if (error.status === 403) return { ok: false, error: "Gmail refused this change. Reconnect the account in Settings." };
    return { ok: false, error: `Gmail error (${error.status || "network"}): ${error.message}` };
  }
  console.error("Mail action failed:", error);
  return { ok: false, error: errorMessage(error) };
}

/** Archive, trash, read/unread, star… on one or more conversations. */
export async function threadAction(
  threads: { accountId: string; threadId: string }[],
  action: ThreadAction,
  options: { refresh?: boolean } = {},
): Promise<MailResult<{ done: number }>> {
  await requireSession();
  const parsed = z.array(threadRef).min(1).max(100).safeParse(threads);
  if (!parsed.success || !actions.includes(action)) return { ok: false, error: "Invalid request" };
  let done = 0;
  const errors: string[] = [];
  for (const t of parsed.data) {
    try {
      await applyThreadAction(t.accountId, t.threadId, action);
      done++;
    } catch (error) {
      errors.push(failure(error).error);
    }
  }
  if (options.refresh !== false) refresh();
  if (errors.length && !done) return { ok: false, error: errors[0] };
  return { ok: true, done };
}

const archiveAllSchema = z.object({
  accountId: uuid.nullish(),
  category: z.enum(["primary", "social", "promotions", "updates", "forums"]).nullish(),
});

/**
 * Conversations in the Inbox (a tab, or every tab when `category` is null;
 * one account or all) — the "Archive all N conversations…" confirmation.
 */
export async function inboxCountAction(input: z.input<typeof archiveAllSchema>): Promise<MailResult<{ count: number }>> {
  await requireSession();
  const parsed = archiveAllSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  return { ok: true, count: await countInboxThreads({ accountId: parsed.data.accountId ?? null, category: parsed.data.category ?? null }) };
}

export interface ArchiveAllPreview {
  /** Conversations in the tab (`category`), counted in the accounts that will be archived. */
  count: number;
  /** The same across every inbox tab (equals `count` when no tab was given). */
  total: number;
  /** Accounts that will be archived. */
  ready: number;
  /** Accounts in scope that will be left out, as sentences ("Reconnect x in Settings to allow changes"). */
  blocked: string[];
}

/**
 * What "Archive all" would do, for its confirmation: the stored counts
 * (as current as the last sync) for the tab and for the whole inbox, in the
 * accounts archiveAllInbox will touch (active, allowed to change labels),
 * and the accounts it would leave out. One action (actions run one at a time
 * per client) so both counts arrive together.
 */
export async function archiveAllPreviewAction(input: z.input<typeof archiveAllSchema>): Promise<MailResult<ArchiveAllPreview>> {
  await requireSession();
  const parsed = archiveAllSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const accountId = parsed.data.accountId ?? null;
  const category = parsed.data.category ?? null;
  try {
    const records = accountId ? [await getAccount(accountId)] : await listAccounts();
    const inScope = records.filter((a): a is NonNullable<typeof a> => a !== null && a.status !== "disconnected");
    if (!inScope.length) return { ok: false, error: accountId ? "Gmail account not found" : "Connect a Gmail account in Settings first" };
    // The same rule as archiveAllInbox: active and granted the modify scope.
    const ready = inScope.filter((a) => a.status === "active" && canModify(a.scopes));
    const blocked = inScope
      .filter((a) => !ready.includes(a))
      .map((a) => (a.status === "active" ? `Reconnect ${a.email} in Settings to allow changes` : `Reconnect ${a.email} in Settings`));
    const counts = await Promise.all(
      ready.map(async (a) => {
        const [tab, all] = await Promise.all([
          countInboxThreads({ accountId: a.id, category }),
          category ? countInboxThreads({ accountId: a.id, category: null }) : null,
        ]);
        return { tab, all: all ?? tab };
      }),
    );
    return {
      ok: true,
      count: counts.reduce((sum, c) => sum + c.tab, 0),
      total: counts.reduce((sum, c) => sum + c.all, 0),
      ready: ready.length,
      blocked,
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * "Archive all" in the Inbox: archives every conversation of the scope in
 * Gmail (a tab — `category` — or the whole inbox; one account or every
 * account that allows changes). Up to 20,000 messages per account per call:
 * `more` = some are left, call again. Mail stays in All Mail and search.
 */
export async function archiveAllAction(
  input: z.input<typeof archiveAllSchema>,
): Promise<
  MailResult<{
    archived: number;
    messages: number;
    accounts: number;
    more: boolean;
    /** Accounts that failed or were left out (to reconnect), as sentences. */
    warnings: string[];
  }>
> {
  await requireSession();
  const parsed = archiveAllSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  try {
    const result = await archiveAllInbox({ accountId: parsed.data.accountId ?? null, category: parsed.data.category ?? null });
    refresh();
    return {
      ok: true,
      archived: result.archived,
      messages: result.messages,
      accounts: result.accounts,
      more: result.more,
      warnings: [...result.errors.map((e) => `${e.email}: ${e.error}`), ...result.skipped.map((s) => s.reason)],
    };
  } catch (error) {
    refresh();
    return failure(error);
  }
}

export async function labelAction(accountId: string, threadId: string, add: string[], remove: string[]): Promise<MailResult> {
  await requireSession();
  const labels = z.array(gmailId).max(20);
  if (!threadRef.safeParse({ accountId, threadId }).success || !labels.safeParse(add).success || !labels.safeParse(remove).success) {
    return { ok: false, error: "Invalid request" };
  }
  try {
    await changeThreadLabels(accountId, threadId, add, remove);
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

const addressList = z.array(z.string().trim().min(3).max(320)).max(100);

const SendSchema = z.object({
  accountId: uuid,
  to: addressList,
  cc: addressList.default([]),
  bcc: addressList.default([]),
  subject: z.string().max(998),
  body: z.string().max(200_000),
  replyToGmailMessageId: gmailId.nullish(),
});

/** The composer's Send (the owner pressed it: this is the approval). */
export async function sendMailAction(input: z.input<typeof SendSchema>): Promise<MailResult<{ threadId: string }>> {
  await requireSession();
  const parsed = SendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the recipients and the message." };
  try {
    const sent = await sendMail(parsed.data);
    refresh();
    return { ok: true, threadId: sent.threadId };
  } catch (error) {
    return failure(error);
  }
}

export interface RecipientSuggestion {
  email: string;
  name: string | null;
  contactId: string | null;
  organization: string | null;
}

/** Autocomplete for To/Cc/Bcc: CRM contacts first, then anyone you have emailed. */
export async function suggestRecipients(query: string): Promise<RecipientSuggestion[]> {
  await requireSession();
  const q = query.trim().toLowerCase().slice(0, 100);
  if (q.length < 1) return [];
  const pattern = likePattern(q);
  const contacts = await sql<RecipientSuggestion[]>`
    select ce.email, nullif(btrim(c.name), '') as name, c.id as contact_id, o.name as organization
      from contact_emails ce
      join contacts c on c.id = ce.contact_id
      left join organizations o on o.id = c.organization_id
     where c.status <> 'archived'
       and (ce.email like ${pattern} or lower(coalesce(c.name, '')) like ${pattern} or lower(coalesce(o.name, '')) like ${pattern})
     order by c.last_contacted_at desc nulls last, ce.is_primary desc
     limit 8
  `;
  if (contacts.length >= 8) return contacts;
  const known = new Set(contacts.map((c) => c.email));
  const others = await sql<{ email: string; name: string | null }[]>`
    select mp.email, max(mp.name) as name
      from message_participants mp
      join messages m on m.id = mp.message_id
     where m.direction = 'outbound' and mp.role in ('to', 'cc', 'bcc')
       and (mp.email like ${pattern} or lower(coalesce(mp.name, '')) like ${pattern})
       and not exists (select 1 from self_addresses s where s.email = mp.email)
     group by mp.email
     order by max(m.sent_at) desc
     limit 8
  `;
  return [
    ...contacts,
    ...others.filter((o) => !known.has(o.email)).map((o) => ({ ...o, contactId: null, organization: null })),
  ].slice(0, 8);
}

const WriteSchema = z.object({
  kind: z.enum(["reply", "reply_all", "forward", "new"]),
  accountId: uuid.nullish(),
  threadId: gmailId.nullish(),
  to: z.array(z.string().max(320)).max(100),
  subject: z.string().max(998),
  body: z.string().max(50_000),
  instructions: z.string().max(2_000),
});

/** "Write with Claude" in the composer: returns text only, nothing is sent. */
export async function writeWithClaudeAction(input: z.input<typeof WriteSchema>): Promise<MailResult<{ subject: string; body: string }>> {
  await requireSession();
  const parsed = WriteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  try {
    const result = await writeEmailWithClaude(parsed.data);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: draftErrorMessage(error) };
  }
}

export async function summarizeThreadAction(accountId: string, threadId: string): Promise<MailResult<{ summary: ThreadSummaryResult }>> {
  await requireSession();
  if (!threadRef.safeParse({ accountId, threadId }).success) return { ok: false, error: "Invalid request" };
  try {
    return { ok: true, summary: await summarizeThread(accountId, threadId) };
  } catch (error) {
    return { ok: false, error: draftErrorMessage(error) };
  }
}

/**
 * "Draft reply with Claude → Approvals": Claude writes the reply to the latest
 * message of the thread and puts it in the approval queue (and Gmail drafts).
 */
export async function queueReplyAction(accountId: string, threadId: string, instructions: string): Promise<MailResult<{ draftId: string }>> {
  await requireSession();
  if (!threadRef.safeParse({ accountId, threadId }).success) return { ok: false, error: "Invalid request" };
  try {
    const [latest] = await sql<
      { id: string; direction: string; fromEmail: string | null; replyTo: string | null; toEmails: string[] | null; contactId: string | null }[]
    >`
      select m.id, m.direction, m.from_email,
             (select array_agg(mp.email order by mp.email) from message_participants mp
               where mp.message_id = m.id and mp.role = 'to') as to_emails,
             (select mp.email from message_participants mp where mp.message_id = m.id and mp.role = 'reply_to' limit 1) as reply_to,
             (select ce.contact_id from message_participants mp join contact_emails ce on ce.email = mp.email
               where mp.message_id = m.id and mp.role in ('from', 'reply_to', 'to') order by (mp.role = 'from') desc limit 1) as contact_id
        from messages m
       where m.account_id = ${accountId} and m.gmail_thread_id = ${threadId}
         and not (m.label_ids && '{TRASH,SPAM,DELETED}')
       order by (m.direction = 'inbound') desc, m.sent_at desc
       limit 1
    `;
    if (!latest) return { ok: false, error: "This conversation has not been synced yet." };
    // Reply to the sender; when only the owner wrote in this thread, follow up with the same recipients.
    const to = (latest.direction === "inbound" ? [latest.replyTo ?? latest.fromEmail] : (latest.toEmails ?? [])).filter(
      (e): e is string => Boolean(e),
    );
    if (!to.length) return { ok: false, error: "This conversation has no one to reply to." };
    const written = await writeEmailWithClaude({ kind: "reply", accountId, threadId, to, subject: "", body: "", instructions });
    const draft = await proposeEmail({
      accountId,
      contactId: latest.contactId,
      to,
      subject: written.subject,
      body: written.body,
      replyToMessageId: latest.id,
      purpose: "reply",
      origin: "owner",
      rationale: instructions.trim() ? `Reply written from your note: ${instructions.trim().slice(0, 200)}` : "Reply to the latest message in this conversation.",
      restrictRecipients: true,
    });
    if (!draft) return { ok: false, error: "There is already an open proposal for this person in Approvals." };
    refresh();
    return { ok: true, draftId: draft.id };
  } catch (error) {
    if (error instanceof DraftError) return { ok: false, error: error.message };
    return { ok: false, error: draftErrorMessage(error) };
  }
}
