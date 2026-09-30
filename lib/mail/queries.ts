import "server-only";
import type { PendingQuery, Row } from "postgres";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { likePattern, messageMatches } from "@/lib/queries/shared";
import type { ContactStatus } from "@/lib/types";
import { CATEGORY_LABELS, parseMailQuery, type InboxCategory, type MailFilter } from "@/lib/mail/search";

/**
 * Thread lists for the mail client, read from the synced `messages` table
 * (instant, unified across accounts). A thread (account + Gmail thread id)
 * is in a view when any of its messages matches; threads are ordered by
 * their latest matching message.
 */

export type MailView = "inbox" | "starred" | "important" | "sent" | "all" | "trash" | "label";

export const PAGE_SIZE = 50;
/** Newest matching messages scanned per page (enough for 50 threads in practice). */
const SCAN_WINDOW = 2500;

const CATEGORY_IDS = Object.values(CATEGORY_LABELS);

export interface ThreadSender {
  name: string | null;
  email: string | null;
  outbound: boolean;
  unread: boolean;
}

export interface ThreadSummary {
  /** `${accountId}:${threadId}`, unique across accounts. */
  key: string;
  accountId: string;
  accountEmail: string;
  threadId: string;
  subject: string | null;
  snippet: string | null;
  lastAt: Date;
  messageCount: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  hasAttachments: boolean;
  automated: boolean;
  labelIds: string[];
  /** Sender of every visible message, oldest first. */
  senders: ThreadSender[];
  /** CRM contact for the conversation (latest external sender, else recipient). */
  contact: { id: string; displayName: string; status: ContactStatus } | null;
}

export interface ThreadPage {
  threads: ThreadSummary[];
  /** Opaque cursor for the next page, null at the end. */
  next: string | null;
}

export interface ThreadListParams {
  view: MailView;
  /** Inbox tab; ignored by other views. */
  category?: InboxCategory | null;
  /** For view "label". */
  labelId?: string | null;
  accountId?: string | null;
  /** Gmail-style query; when set, searches instead of listing the view. */
  q?: string | null;
  cursor?: string | null;
  limit?: number;
  /** Maps a `label:` term to label ids (user labels are per account). */
  resolveLabel?: (name: string) => string[];
}

interface Cursor {
  at: Date;
  accountId: string;
  threadId: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.at.toISOString(), c.accountId, c.threadId])).toString("base64url");
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const [at, accountId, threadId] = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as string[];
    const date = new Date(at);
    if (Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(accountId) || typeof threadId !== "string") return null;
    return { at: date, accountId, threadId };
  } catch {
    return null;
  }
}

type Fragment = PendingQuery<Row[]>;

function and(parts: Fragment[]): Fragment {
  if (!parts.length) return sql`true`;
  return parts.reduce((acc, part) => sql`${acc} and ${part}`);
}

type Scope = "default" | "trash" | "anywhere";

/** Which messages of a thread are shown at all. */
function visible(scope: Scope): Fragment {
  if (scope === "trash") return sql`m.label_ids @> '{TRASH}'`;
  if (scope === "anywhere") return sql`not (m.label_ids @> '{DELETED}')`;
  return sql`not (m.label_ids && '{TRASH,SPAM,DELETED}')`;
}

function categoryCondition(category: InboxCategory): Fragment {
  if (category === "primary") return sql`not (m.label_ids && ${CATEGORY_IDS}::text[])`;
  return sql`m.label_ids @> ${[CATEGORY_LABELS[category]]}::text[]`;
}

const SYSTEM_LABELS = new Set([
  "INBOX",
  "SENT",
  "STARRED",
  "IMPORTANT",
  "UNREAD",
  "TRASH",
  "SPAM",
  ...CATEGORY_IDS,
]);

function defaultResolveLabel(name: string): string[] {
  const upper = name.toUpperCase().replace(/[\s-]+/g, "_");
  if (SYSTEM_LABELS.has(upper)) return [upper];
  return [name];
}

function textMatch(column: Fragment, value: string): Fragment {
  return sql`lower(coalesce(${column}, '')) like ${likePattern(value.toLowerCase())}`;
}

function recipientMatch(value: string): Fragment {
  const pattern = likePattern(value.toLowerCase());
  return sql`exists (
    select 1 from message_participants mp
     where mp.message_id = m.id and mp.role in ('to', 'cc', 'bcc')
       and (mp.email like ${pattern} or lower(coalesce(mp.name, '')) like ${pattern})
  )`;
}

/** Message-level conditions for a parsed search. */
export function filterConditions(filter: MailFilter, resolveLabel: (name: string) => string[]): { parts: Fragment[]; scope: Scope } {
  const parts: Fragment[] = [];
  let scope: Scope = "default";

  if (filter.text) parts.push(messageMatches(filter.text));
  for (const v of filter.from) parts.push(v === "me" ? sql`m.direction = 'outbound'` : sql`(${textMatch(sql`m.from_email`, v)} or ${textMatch(sql`m.from_name`, v)})`);
  for (const v of filter.notFrom) parts.push(v === "me" ? sql`m.direction <> 'outbound'` : sql`not (${textMatch(sql`m.from_email`, v)} or ${textMatch(sql`m.from_name`, v)})`);
  for (const v of filter.to) parts.push(v === "me" ? sql`m.direction = 'inbound'` : recipientMatch(v));
  for (const v of filter.notTo) parts.push(v === "me" ? sql`m.direction <> 'inbound'` : sql`not ${recipientMatch(v)}`);
  for (const v of filter.subject) parts.push(textMatch(sql`m.subject`, v));
  for (const v of filter.notSubject) parts.push(sql`not ${textMatch(sql`m.subject`, v)}`);
  for (const v of filter.labels) parts.push(sql`m.label_ids && ${resolveLabel(v)}::text[]`);
  for (const v of filter.notLabels) parts.push(sql`not (m.label_ids && ${resolveLabel(v)}::text[])`);
  if (filter.hasAttachment) parts.push(sql`m.has_attachments`);
  if (filter.category) parts.push(categoryCondition(filter.category));
  if (filter.after) parts.push(sql`m.sent_at >= (${filter.after}::date::timestamp at time zone ${env.timezone})`);
  if (filter.before) parts.push(sql`m.sent_at < (${filter.before}::date::timestamp at time zone ${env.timezone})`);
  if (filter.newerThan) parts.push(sql`m.sent_at > now() - ${filter.newerThan}::interval`);
  if (filter.olderThan) parts.push(sql`m.sent_at < now() - ${filter.olderThan}::interval`);

  switch (filter.in) {
    case "inbox":
      parts.push(sql`m.label_ids @> '{INBOX}'`);
      break;
    case "sent":
      parts.push(sql`m.label_ids @> '{SENT}'`);
      break;
    case "starred":
      parts.push(sql`m.label_ids @> '{STARRED}'`);
      break;
    case "trash":
      scope = "trash";
      break;
    case "anywhere":
      scope = "anywhere";
      break;
  }
  return { parts, scope };
}

function viewConditions(params: ThreadListParams): { parts: Fragment[]; scope: Scope } {
  const resolveLabel = params.resolveLabel ?? defaultResolveLabel;
  const q = params.q?.trim();
  if (q) return filterConditions(parseMailQuery(q), resolveLabel);

  switch (params.view) {
    case "inbox":
      return {
        parts: [sql`m.label_ids @> '{INBOX}'`, categoryCondition(params.category ?? "primary")],
        scope: "default",
      };
    case "starred":
      return { parts: [sql`m.label_ids @> '{STARRED}'`], scope: "default" };
    case "important":
      return { parts: [sql`m.label_ids @> '{IMPORTANT}'`], scope: "default" };
    case "sent":
      return { parts: [sql`m.label_ids @> '{SENT}'`], scope: "default" };
    case "trash":
      return { parts: [], scope: "trash" };
    case "label":
      return { parts: [sql`m.label_ids @> ${[params.labelId ?? ""]}::text[]`], scope: "default" };
    case "all":
    default:
      return { parts: [], scope: "default" };
  }
}

type ThreadRow = Omit<ThreadSummary, "key">;

export async function listThreads(params: ThreadListParams): Promise<ThreadPage> {
  const limit = Math.min(Math.max(params.limit ?? PAGE_SIZE, 1), 100);
  const cursor = decodeCursor(params.cursor);
  const { parts, scope } = viewConditions(params);
  const shown = visible(scope);
  const account = params.accountId ? sql`m.account_id = ${params.accountId}` : sql`true`;
  const matches = and([shown, account, ...parts]);

  const rows = await sql<ThreadRow[]>`
    with recent as (
      select m.account_id, m.gmail_thread_id
        from messages m
       where ${matches}
         ${cursor ? sql`and m.sent_at <= ${cursor.at}` : sql``}
       order by m.sent_at desc
       limit ${SCAN_WINDOW}
    ),
    hits as (
      select c.account_id, c.gmail_thread_id,
             (select max(m.sent_at) from messages m
               where m.account_id = c.account_id and m.gmail_thread_id = c.gmail_thread_id and ${matches}) as hit_at
        from (select distinct account_id, gmail_thread_id from recent) c
    ),
    page as (
      select * from hits
       where ${cursor ? sql`(hit_at, account_id, gmail_thread_id) < (${cursor.at}, ${cursor.accountId}::uuid, ${cursor.threadId})` : sql`true`}
       order by hit_at desc, account_id desc, gmail_thread_id desc
       limit ${limit + 1}
    )
    select p.account_id,
           a.email as account_email,
           p.gmail_thread_id as thread_id,
           p.hit_at as last_at,
           t.message_count,
           t.unread,
           t.starred,
           t.important,
           t.has_attachments,
           t.automated,
           t.subject,
           t.snippet,
           t.senders,
           coalesce((
             select array_agg(distinct l order by l)
               from messages m, unnest(m.label_ids) l
              where m.account_id = p.account_id and m.gmail_thread_id = p.gmail_thread_id and ${shown}
           ), '{}') as label_ids,
           (
             select json_build_object(
                      'id', c.id,
                      'displayName', coalesce(nullif(btrim(c.name), ''), ce.email),
                      'status', c.status)
               from messages m
               join message_participants mp on mp.message_id = m.id and mp.role in ('from', 'to', 'cc')
               join contact_emails ce on ce.email = mp.email
               join contacts c on c.id = ce.contact_id
              where m.account_id = p.account_id and m.gmail_thread_id = p.gmail_thread_id and ${shown}
              order by (mp.role = 'from') desc, m.sent_at desc, mp.email
              limit 1
           ) as contact
      from page p
      join gmail_accounts a on a.id = p.account_id
      cross join lateral (
        select count(*)::int as message_count,
               bool_or(m.label_ids @> '{UNREAD}') as unread,
               bool_or(m.label_ids @> '{STARRED}') as starred,
               bool_or(m.label_ids @> '{IMPORTANT}') as important,
               bool_or(m.has_attachments) as has_attachments,
               bool_and(m.is_automated) as automated,
               (array_agg(m.subject order by m.sent_at) filter (where nullif(btrim(m.subject), '') is not null))[1] as subject,
               (array_agg(m.snippet order by m.sent_at desc))[1] as snippet,
               json_agg(json_build_object(
                 'name', m.from_name,
                 'email', m.from_email,
                 'outbound', m.direction = 'outbound',
                 'unread', m.label_ids @> '{UNREAD}'
               ) order by m.sent_at) as senders
          from messages m
         where m.account_id = p.account_id and m.gmail_thread_id = p.gmail_thread_id and ${shown}
      ) t
     order by p.hit_at desc, p.account_id desc, p.gmail_thread_id desc
  `;

  const hasMore = rows.length > limit;
  const threads = rows.slice(0, limit).map((row) => ({ ...row, key: `${row.accountId}:${row.threadId}` }));
  const last = threads[threads.length - 1];
  return {
    threads,
    next: hasMore && last ? encodeCursor({ at: last.lastAt, accountId: last.accountId, threadId: last.threadId }) : null,
  };
}

export interface MailCounts {
  /** Unread threads in the inbox, per tab. */
  inbox: Record<InboxCategory, number>;
  /** Unread Primary threads per account id. */
  byAccount: Record<string, number>;
  /** Unread threads per user label id. */
  labels: Record<string, number>;
}

/** Unread counts for the sidebar and tabs (optionally for one account). */
export async function getMailCounts(accountId?: string | null): Promise<MailCounts> {
  const account = accountId ? sql`and m.account_id = ${accountId}` : sql``;
  const [inboxRows, labelRows] = await Promise.all([
    sql<{ accountId: string; primary: number; promotions: number; social: number; updates: number; forums: number }[]>`
      select m.account_id,
             count(distinct m.gmail_thread_id) filter (where not (m.label_ids && ${CATEGORY_IDS}::text[]))::int as primary,
             count(distinct m.gmail_thread_id) filter (where m.label_ids @> '{CATEGORY_PROMOTIONS}')::int as promotions,
             count(distinct m.gmail_thread_id) filter (where m.label_ids @> '{CATEGORY_SOCIAL}')::int as social,
             count(distinct m.gmail_thread_id) filter (where m.label_ids @> '{CATEGORY_UPDATES}')::int as updates,
             count(distinct m.gmail_thread_id) filter (where m.label_ids @> '{CATEGORY_FORUMS}')::int as forums
        from messages m
       where m.label_ids @> '{INBOX,UNREAD}' and not (m.label_ids && '{TRASH,SPAM,DELETED}') ${account}
       group by m.account_id
    `,
    sql<{ label: string; count: number }[]>`
      select l as label, count(distinct (m.account_id, m.gmail_thread_id))::int as count
        from messages m, unnest(m.label_ids) l
       where m.label_ids @> '{UNREAD}' and not (m.label_ids && '{TRASH,SPAM,DELETED}') and l like 'Label\\_%' ${account}
       group by l
    `,
  ]);

  const inbox: Record<InboxCategory, number> = { primary: 0, promotions: 0, social: 0, updates: 0, forums: 0 };
  const byAccount: Record<string, number> = {};
  for (const row of inboxRows) {
    inbox.primary += row.primary;
    inbox.promotions += row.promotions;
    inbox.social += row.social;
    inbox.updates += row.updates;
    inbox.forums += row.forums;
    byAccount[row.accountId] = row.primary;
  }
  const labels: Record<string, number> = {};
  for (const row of labelRows) labels[row.label] = row.count;
  return { inbox, byAccount, labels };
}

/**
 * Apply a label change to the stored copies right away (Gmail has already
 * been updated; live sync will confirm). Scope: whole thread, or given messages.
 */
export async function applyLabelChange(params: {
  accountId: string;
  threadId: string;
  messageIds?: string[];
  add?: string[];
  remove?: string[];
}): Promise<void> {
  const add = params.add ?? [];
  const remove = params.remove ?? [];
  if (!add.length && !remove.length) return;
  await sql`
    update messages m
       set label_ids = array(
             select distinct l from unnest(m.label_ids || ${add}::text[]) l
              where l <> all(${remove}::text[])
              order by l)
     where m.account_id = ${params.accountId}
       and m.gmail_thread_id = ${params.threadId}
       ${params.messageIds?.length ? sql`and m.gmail_message_id = any(${params.messageIds}::text[])` : sql``}
  `;
}

/** Account + thread exists in the database (used to authorize thread actions). */
export async function threadExists(accountId: string, threadId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from messages where account_id = ${accountId} and gmail_thread_id = ${threadId} limit 1
  `;
  return Boolean(row);
}

/** Unread threads per user label, per account (label ids like Label_1 repeat across accounts). */
export async function unreadLabelCountsByAccount(): Promise<Record<string, Record<string, number>>> {
  const rows = await sql<{ accountId: string; label: string; count: number }[]>`
    select m.account_id, l as label, count(distinct m.gmail_thread_id)::int as count
      from messages m, unnest(m.label_ids) l
     where m.label_ids @> '{UNREAD}' and not (m.label_ids && '{TRASH,SPAM,DELETED}') and l like 'Label\\_%'
     group by m.account_id, l
  `;
  const out: Record<string, Record<string, number>> = {};
  for (const row of rows) (out[row.accountId] ??= {})[row.label] = row.count;
  return out;
}

/** Stored labels of each message of a thread (for the offline copy of a thread), by Gmail message id. */
export async function storedThreadLabels(accountId: string, threadId: string): Promise<Record<string, string[]>> {
  const rows = await sql<{ gmailMessageId: string; labelIds: string[] }[]>`
    select gmail_message_id, label_ids from messages where account_id = ${accountId} and gmail_thread_id = ${threadId}
  `;
  return Object.fromEntries(rows.map((r) => [r.gmailMessageId, r.labelIds]));
}
