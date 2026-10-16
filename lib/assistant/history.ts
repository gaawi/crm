import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";

/**
 * Every earlier conversation with a person or an organization, from all our
 * mailboxes (monitor-only ones included: reading never changes them), so the
 * routine can pick up where the owner or Josefina left off instead of
 * writing as if it were a first contact (GET /api/assistant-agent/history).
 */

export class HistoryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const querySchema = z.object({
  contactId: z.guid().nullish(),
  organizationId: z.guid().nullish(),
  email: z.string().trim().toLowerCase().max(320).nullish(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const BODY_MAX = 4000;
/** More recipients than this: a mass email (its list is not repeated). */
const BULK = 5;

export interface HistoryMessage {
  date: string;
  direction: "inbound" | "outbound";
  mailbox: string;
  from: string;
  to: string[];
  recipients: number;
  bulk: boolean;
  subject: string | null;
  body: string;
}

export async function listHistory(params: URLSearchParams): Promise<{ count: number; messages: HistoryMessage[] }> {
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new HistoryError("Pass contactId, organizationId or email (and optionally limit, max 100).", 400);
  const { contactId, organizationId, email, limit } = parsed.data;
  if (!contactId && !organizationId && !email) throw new HistoryError("Pass contactId, organizationId or email.", 400);
  const rows = await sql<
    {
      sentAt: Date;
      direction: "inbound" | "outbound";
      mailbox: string;
      fromName: string | null;
      fromEmail: string | null;
      recipients: string[] | null;
      subject: string | null;
      body: string | null;
    }[]
  >`
    with people as (
      select ce.email from contact_emails ce join contacts c on c.id = ce.contact_id
       where ${contactId ? sql`c.id = ${contactId}` : sql`false`}
          or ${organizationId ? sql`c.organization_id = ${organizationId}` : sql`false`}
      union
      select ${email ?? null}::text where ${email ?? null}::text is not null
    ),
    ids as (
      select mp.message_id from people p join message_participants mp on mp.email = p.email
      union
      -- An organization's correspondence also includes any address at its domains (a former director, a new one).
      select mp.message_id
        from organizations o
        cross join lateral unnest(o.domains) as dom(domain)
        join message_participants mp on split_part(mp.email, '@', 2) = dom.domain
       where o.id = ${organizationId ?? null}::uuid
         and mp.email not in (select email from self_addresses)
    ),
    picked as (
      -- One row per email (a message stored in several mailboxes counts once).
      select distinct on (coalesce(m.rfc822_message_id, m.id::text)) m.id
        from ids
        join messages m on m.id = ids.message_id
       where not m.is_automated
       order by coalesce(m.rfc822_message_id, m.id::text), (m.direction = 'inbound'), m.sent_at
    )
    select m.sent_at, m.direction, a.email as mailbox, m.from_name, m.from_email,
           (select array_agg(mp.email order by mp.role, mp.email) from message_participants mp
             where mp.message_id = m.id and mp.role in ('to', 'cc', 'bcc')) as recipients,
           m.subject, left(coalesce(nullif(m.body_text, ''), m.snippet), ${BODY_MAX}) as body
      from picked
      join messages m on m.id = picked.id
      join gmail_accounts a on a.id = m.account_id
     order by m.sent_at desc
     limit ${limit}`;
  const messages = rows.map((r) => {
    const recipients = r.recipients ?? [];
    const bulk = recipients.length > BULK;
    return {
      date: r.sentAt.toISOString(),
      direction: r.direction,
      mailbox: r.mailbox,
      from: r.fromName ? `${r.fromName} <${r.fromEmail ?? ""}>` : (r.fromEmail ?? ""),
      to: bulk ? recipients.filter((e) => email && e === email).concat(`(mass email to ${recipients.length} people)`) : recipients,
      recipients: recipients.length,
      bulk,
      subject: r.subject,
      body: r.body ?? "",
    };
  });
  return { count: messages.length, messages };
}
