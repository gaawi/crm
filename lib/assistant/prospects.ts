import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { messageMatches } from "@/lib/queries/shared";

/**
 * People we have written to (from any of our mailboxes, Guillermo's and
 * Josefina's included) who are not yet rows of a campaign: the prospector's
 * first source of new prospects (GET /api/assistant-agent/prospects).
 * Narrowed with a search (subject and text of our emails to them), newest
 * first, with what the exchange looked like.
 */

export class ProspectsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const querySchema = z.object({
  projectId: z.guid(),
  q: z.string().trim().max(200).optional(),
  since: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export interface Prospect {
  email: string;
  name: string | null;
  contactId: string | null;
  organization: { id: string; name: string; website: string | null } | null;
  /** Rows of other campaigns this person already belongs to. */
  otherCampaigns: string[];
  sentCount: number;
  /** Of them, mass emails (more than 5 recipients). */
  bulkCount: number;
  receivedCount: number;
  firstSent: string;
  lastSent: string;
  lastReceived: string | null;
  lastSubject: string | null;
  mailboxes: string[];
}

export async function listProspects(params: URLSearchParams): Promise<{ projectId: string; count: number; prospects: Prospect[] }> {
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new ProspectsError("Pass projectId (a campaign) and optionally q, since=YYYY-MM-DD, limit (max 200), offset.", 400);
  const { projectId, q, since, limit, offset } = parsed.data;
  const [project] = await sql`select 1 from projects where id = ${projectId} and sheet`;
  if (!project) throw new ProspectsError("Campaign not found.", 404);

  const rows = await sql<
    {
      email: string;
      name: string | null;
      contactId: string | null;
      organization: Prospect["organization"];
      otherCampaigns: string[] | null;
      sentCount: number;
      bulkCount: number;
      receivedCount: number;
      firstSent: Date;
      lastSent: Date;
      lastReceived: Date | null;
      lastSubject: string | null;
      mailboxes: string[];
    }[]
  >`
    with own as (
      select lower(email) as email from gmail_accounts
      union select distinct lower(from_email) from messages where direction = 'outbound' and from_email is not null
    ),
    sent as (
      select mp.email, m.id, m.sent_at, m.subject, a.email as mailbox,
             (select count(*) from message_participants r where r.message_id = m.id and r.role in ('to', 'cc', 'bcc')) > 5 as bulk
        from messages m
        join gmail_accounts a on a.id = m.account_id
        join message_participants mp on mp.message_id = m.id and mp.role in ('to', 'cc', 'bcc')
       where m.direction = 'outbound' and not m.is_automated
         and mp.email not in (select email from own)
         ${since ? sql`and m.sent_at >= ${since}::date` : sql``}
         ${q ? sql`and ${messageMatches(q)}` : sql``}
    ),
    people as (
      select s.email, count(distinct s.id)::int as sent_count, count(distinct s.id) filter (where s.bulk)::int as bulk_count,
             min(s.sent_at) as first_sent, max(s.sent_at) as last_sent,
             (array_agg(s.subject order by s.sent_at desc))[1] as last_subject,
             array_agg(distinct s.mailbox) as mailboxes
        from sent s
       group by s.email
    )
    select p.email, nullif(btrim(c.name), '') as name, c.id as contact_id,
           case when o.id is null then null else json_build_object('id', o.id, 'name', o.name, 'website', o.website) end as organization,
           (select array_agg(distinct pr.name) from opportunities op join projects pr on pr.id = op.project_id
             where op.contact_id = c.id and pr.id <> ${projectId}) as other_campaigns,
           p.sent_count, p.bulk_count,
           (select count(*)::int from messages m join message_participants mp on mp.message_id = m.id and mp.role = 'from'
             where mp.email = p.email and m.direction = 'inbound') as received_count,
           p.first_sent, p.last_sent,
           (select max(m.sent_at) from messages m join message_participants mp on mp.message_id = m.id and mp.role = 'from'
             where mp.email = p.email and m.direction = 'inbound') as last_received,
           p.last_subject, p.mailboxes
      from people p
      left join contact_emails ce on ce.email = p.email
      left join contacts c on c.id = ce.contact_id
      left join organizations o on o.id = c.organization_id
     where (c.id is null or c.status <> 'archived')
       and not exists (
         select 1 from opportunities op
           left join contact_emails x on x.contact_id = op.contact_id
          where op.project_id = ${projectId} and (x.email = p.email or (c.organization_id is not null and op.organization_id = c.organization_id)))
     order by p.last_sent desc
     limit ${limit} offset ${offset}`;

  return {
    projectId,
    count: rows.length,
    prospects: rows.map((r) => ({
      ...r,
      otherCampaigns: r.otherCampaigns ?? [],
      firstSent: r.firstSent.toISOString(),
      lastSent: r.lastSent.toISOString(),
      lastReceived: r.lastReceived?.toISOString() ?? null,
    })),
  };
}
