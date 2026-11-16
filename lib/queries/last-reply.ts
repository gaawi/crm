import "server-only";
import { sql } from "@/lib/db";

/**
 * The last thing they wrote to us (a real email: not newsletters, bounces or
 * automatic replies), and our answer after it if there is one. Shown at the top
 * of a contact and of an organization ("Their last reply").
 */
export interface LastReplyMessage {
  accountId: string;
  threadId: string;
  sentAt: string;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  /** The new part of the email (quoted history cut off), trimmed. */
  text: string;
  /** The mailbox it was received in / sent from. */
  accountEmail: string;
}

export interface LastReply {
  theirs: LastReplyMessage;
  /** Our latest email to them after their reply (null = we haven't answered). */
  ours: LastReplyMessage | null;
}

/** Cut the quoted history ("On … wrote:", "> …", "-----Original Message-----"…) and signatures-ish noise. */
export function newPart(body: string | null | undefined, max = 900): string {
  const text = (body ?? "").replace(/\r/g, "");
  const cuts = [
    /\n\s*On .{3,200}(wrote|escribi[oó]):\s*\n/i,
    /\n\s*El .{3,200}escribi[oó]:\s*\n/i,
    /\n\s*-{2,}\s*Original Message\s*-{2,}/i,
    /\n\s*-{2,}\s*Mensaje original\s*-{2,}/i,
    /\n\s*From: .+\n\s*(Sent|Date): /i,
    /\n\s*De: .+\n\s*(Enviado|Fecha): /i,
    /\n>/,
    /\n_{8,}/,
  ];
  let end = text.length;
  for (const re of cuts) {
    const m = re.exec(text);
    if (m && m.index < end) end = m.index;
  }
  const clean = text.slice(0, end).replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, "")}…` : clean;
}

type Row = {
  accountId: string;
  threadId: string;
  sentAt: Date;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  body: string | null;
  snippet: string | null;
  accountEmail: string;
};

const toMessage = (r: Row): LastReplyMessage => ({
  accountId: r.accountId,
  threadId: r.threadId,
  sentAt: r.sentAt.toISOString(),
  fromName: r.fromName,
  fromEmail: r.fromEmail,
  subject: r.subject,
  text: newPart(r.body ?? r.snippet),
  accountEmail: r.accountEmail,
});

/** For one contact, or for every contact of an organization. */
export async function getLastReply(scope: { contactId: string } | { organizationId: string }): Promise<LastReply | null> {
  const emails = await sql<{ email: string }[]>`
    select ce.email from contact_emails ce join contacts c on c.id = ce.contact_id
     where ${
       "contactId" in scope
         ? sql`c.id = ${scope.contactId}`
         : // The organization's people, and the contacts of its campaign rows (not always linked to it).
           sql`(c.organization_id = ${scope.organizationId}
                or c.id in (select op.contact_id from opportunities op where op.organization_id = ${scope.organizationId}))`
     }`;
  const list = emails.map((e) => e.email);
  if (!list.length) return null;

  const [theirs] = await sql<Row[]>`
    select m.account_id, m.gmail_thread_id as thread_id, m.sent_at, m.from_name, m.from_email, m.subject,
           m.body_text as body, m.snippet, a.email as account_email
      from messages m
      join message_participants mp on mp.message_id = m.id and mp.role = 'from'
      join gmail_accounts a on a.id = m.account_id
     where mp.email = any(${list}::text[]) and m.direction = 'inbound'
       and not m.auto_reply and not coalesce(m.is_automated, false)
     order by m.sent_at desc
     limit 1`;
  if (!theirs) return null;

  const [ours] = await sql<Row[]>`
    select m.account_id, m.gmail_thread_id as thread_id, m.sent_at, m.from_name, m.from_email, m.subject,
           m.body_text as body, m.snippet, a.email as account_email
      from messages m
      join message_participants mp on mp.message_id = m.id and mp.role in ('to', 'cc')
      join gmail_accounts a on a.id = m.account_id
     where mp.email = any(${list}::text[]) and m.direction = 'outbound' and m.sent_at > ${theirs.sentAt}
     order by m.sent_at desc
     limit 1`;

  return { theirs: toMessage(theirs), ours: ours ? toMessage(ours) : null };
}
