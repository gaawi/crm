import "server-only";
import { sql } from "@/lib/db";
import type { Address, ContactSummary, EmailMessage } from "@/lib/types";
import { gmailThreadUrl } from "@/lib/utils";

/**
 * SQL fragments shared by the query modules.
 *
 * CONTACT_SUMMARY_COLUMNS selects everything a ContactSummary needs from
 * `contacts c` (joins are lateral subqueries, so any WHERE/ORDER on c works).
 */
export const contactSummaryColumns = () => sql`
  c.id,
  c.name,
  coalesce(nullif(btrim(c.name), ''), e.emails[1], 'Unknown') as display_name,
  e.emails[1] as primary_email,
  coalesce(e.emails, '{}') as emails,
  case when o.id is null then null else json_build_object('id', o.id, 'name', o.name, 'kind', o.kind) end as organization,
  c.role,
  c.tags,
  c.status,
  coalesce(p.projects, '[]'::json) as projects,
  c.follow_up_at,
  c.follow_up_note,
  c.last_contacted_at,
  c.last_inbound_at,
  c.last_outbound_at,
  c.message_count
`;

export const contactSummaryJoins = () => sql`
  left join organizations o on o.id = c.organization_id
  left join lateral (
    select array_agg(ce.email order by ce.is_primary desc, ce.created_at, ce.email) as emails
      from contact_emails ce
     where ce.contact_id = c.id
  ) e on true
  left join lateral (
    select json_agg(json_build_object('id', pr.id, 'name', pr.name, 'color', pr.color)
                    order by pr.sort_order, pr.name) as projects
      from contact_projects cp
      join projects pr on pr.id = cp.project_id
     where cp.contact_id = c.id
  ) p on true
`;

export type ContactSummaryRow = ContactSummary;

/**
 * Columns for an EmailMessage from `messages m` joined to `gmail_accounts a`,
 * plus participants. `accounts` lists every connected account holding the same
 * RFC 822 message.
 */
export const messageColumns = () => sql`
  m.id,
  m.account_id,
  a.email as account_email,
  coalesce((
    select array_agg(distinct a2.email)
      from messages m2
      join gmail_accounts a2 on a2.id = m2.account_id
     where m.rfc822_message_id is not null and m2.rfc822_message_id = m.rfc822_message_id
  ), array[a.email]) as accounts,
  m.gmail_message_id,
  m.gmail_thread_id,
  m.rfc822_message_id,
  m.direction,
  case when m.from_email is null then null
       else json_build_object('email', m.from_email, 'name', m.from_name) end as "from",
  coalesce((
    select json_agg(json_build_object('email', mp.email, 'name', mp.name) order by mp.email)
      from message_participants mp where mp.message_id = m.id and mp.role = 'to'
  ), '[]'::json) as "to",
  coalesce((
    select json_agg(json_build_object('email', mp.email, 'name', mp.name) order by mp.email)
      from message_participants mp where mp.message_id = m.id and mp.role = 'cc'
  ), '[]'::json) as cc,
  m.subject,
  m.snippet,
  m.body_text,
  m.sent_at,
  m.is_automated,
  m.has_attachments,
  m.attachments
`;

interface RawMessageRow {
  id: string;
  accountId: string;
  accountEmail: string;
  accounts: string[];
  gmailMessageId: string;
  gmailThreadId: string;
  rfc822MessageId: string | null;
  direction: "inbound" | "outbound";
  from: Address | null;
  to: Address[];
  cc: Address[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  sentAt: Date;
  isAutomated: boolean;
  hasAttachments: boolean;
  attachments: EmailMessage["attachments"];
}

export function toEmailMessage(row: RawMessageRow): EmailMessage {
  return {
    ...row,
    accounts: row.accounts?.length ? row.accounts : [row.accountEmail],
    gmailUrl: gmailThreadUrl(row.accountEmail, row.gmailThreadId),
  };
}

/** Full-text match on `messages m` (uses the messages_search_idx expression index). */
export const messageMatches = (q: string) => sql`
  message_search_vector(m.subject, m.from_name, m.from_email, coalesce(m.body_text, m.snippet)) @@ message_search_query(${q})
`;

/** Relevance of `messages m` for q (only compute on a small, already-limited set). */
export const messageRank = (q: string) => sql`
  ts_rank(message_search_vector(m.subject, m.from_name, m.from_email, coalesce(m.body_text, m.snippet)), message_search_query(${q}))
`;

/** Escape LIKE wildcards in user input. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function clampLimit(limit: number | undefined, fallback: number, max = 500): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), max);
}
