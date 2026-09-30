import "server-only";
import { sql } from "@/lib/db";
import type { ContactRef, Direction, EmailMessage } from "@/lib/types";
import { clampLimit, messageColumns, toEmailMessage } from "@/lib/queries/shared";

export interface MessageSearch {
  /** websearch_to_tsquery('english', q) against messages.search; optional when other filters are given. */
  q?: string;
  since?: Date;
  until?: Date;
  accountId?: string;
  direction?: Direction;
  contactId?: string;
  organizationId?: string;
  includeAutomated?: boolean;
  limit?: number;
}

export interface MessageHit extends EmailMessage {
  /** ts_rank; 0 when no q. */
  rank: number;
  /** Contacts involved in the message (any role). */
  contacts: ContactRef[];
}

/** Contacts owning any participant address of `m`. */
const messageContacts = () => sql`
  coalesce((
    select json_agg(x.obj)
      from (
        select distinct jsonb_build_object(
                 'id', c.id,
                 'displayName', coalesce(nullif(btrim(c.name), ''), ce.email)
               ) as obj
          from message_participants mp
          join contact_emails ce on ce.email = mp.email
          join contacts c on c.id = ce.contact_id
         where mp.message_id = m.id
      ) x
  ), '[]'::json) as contacts
`;

/** Keep one row per RFC 822 message: the outbound copy, else the first stored. */
const isRepresentative = () => sql`
  not exists (
    select 1 from messages d
     where d.rfc822_message_id = m.rfc822_message_id
       and (d.direction = 'inbound', d.created_at, d.id) < (m.direction = 'inbound', m.created_at, m.id)
  )
`;

/** Full-text search, de-duplicated across accounts. Ordered by rank then date when q is given, else by date. */
export async function searchMessages(search: MessageSearch): Promise<MessageHit[]> {
  const q = search.q?.trim() || null;
  const limit = clampLimit(search.limit, 25, 200);
  const rows = await sql`
    select ${messageColumns()},
           ${q ? sql`ts_rank(m.search, websearch_to_tsquery('english', ${q}))` : sql`0::real`} as rank,
           ${messageContacts()}
      from messages m
      join gmail_accounts a on a.id = m.account_id
     where ${isRepresentative()}
       ${q ? sql`and m.search @@ websearch_to_tsquery('english', ${q})` : sql``}
       ${search.since ? sql`and m.sent_at >= ${search.since}` : sql``}
       ${search.until ? sql`and m.sent_at < ${search.until}` : sql``}
       ${search.accountId ? sql`and m.account_id = ${search.accountId}` : sql``}
       ${search.direction ? sql`and m.direction = ${search.direction}` : sql``}
       ${search.includeAutomated ? sql`` : sql`and not m.is_automated`}
       ${
         search.contactId
           ? sql`and exists (
               select 1 from message_participants mp
                 join contact_emails ce on ce.email = mp.email
                where mp.message_id = m.id and ce.contact_id = ${search.contactId})`
           : sql``
       }
       ${
         search.organizationId
           ? sql`and exists (
               select 1 from message_participants mp
                 join contact_emails ce on ce.email = mp.email
                 join contacts c on c.id = ce.contact_id
                where mp.message_id = m.id and c.organization_id = ${search.organizationId})`
           : sql``
       }
     order by ${q ? sql`rank desc, m.sent_at desc` : sql`m.sent_at desc`}
     limit ${limit}
  `;
  return rows.map((row) => {
    const { rank, contacts, ...rest } = row as never as { rank: number; contacts: ContactRef[] } & Parameters<typeof toEmailMessage>[0];
    return { ...toEmailMessage(rest), rank: Number(rank) || 0, contacts: contacts ?? [] };
  });
}

export async function getMessage(id: string): Promise<EmailMessage | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql`
    select ${messageColumns()} from messages m join gmail_accounts a on a.id = m.account_id where m.id = ${id}
  `;
  return row ? toEmailMessage(row as never) : null;
}

/** All messages of a Gmail thread in one account, oldest first. */
export async function getThread(accountId: string, gmailThreadId: string): Promise<EmailMessage[]> {
  const rows = await sql`
    select ${messageColumns()}
      from messages m join gmail_accounts a on a.id = m.account_id
     where m.account_id = ${accountId} and m.gmail_thread_id = ${gmailThreadId}
     order by m.sent_at asc, m.id
  `;
  return rows.map((row) => toEmailMessage(row as never));
}

/** Latest non-automated messages across all accounts with the main contact of each (sender for inbound, first recipient for outbound). */
export async function recentActivity(limit = 20): Promise<(EmailMessage & { contact: ContactRef | null })[]> {
  const rows = await sql`
    select ${messageColumns()},
           (
             select json_build_object('id', c.id, 'displayName', coalesce(nullif(btrim(c.name), ''), ce.email))
               from message_participants mp
               join contact_emails ce on ce.email = mp.email
               join contacts c on c.id = ce.contact_id
              where mp.message_id = m.id
                and ((m.direction = 'inbound' and mp.role = 'from')
                  or (m.direction = 'outbound' and mp.role in ('to', 'cc', 'bcc')))
              order by (mp.role = 'to') desc, mp.email
              limit 1
           ) as contact
      from messages m
      join gmail_accounts a on a.id = m.account_id
     where not m.is_automated
       and ${isRepresentative()}
     order by m.sent_at desc
     limit ${clampLimit(limit, 20, 100)}
  `;
  return rows.map((row) => {
    const { contact, ...rest } = row as never as { contact: ContactRef | null } & Parameters<typeof toEmailMessage>[0];
    return { ...toEmailMessage(rest), contact };
  });
}

export async function countMessages(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from messages`;
  return row.count;
}
