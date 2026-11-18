import "server-only";
import { sql } from "@/lib/db";
import { newPart } from "@/lib/queries/last-reply";

/**
 * "They replied": people on a campaign sheet whose last real email (not an
 * automatic reply, bounce or newsletter) came after ours, newest first, with
 * what they wrote. The top of Today, so no reply waits for weeks.
 */
export interface CampaignReply {
  contactId: string;
  contactName: string;
  organizationName: string | null;
  projectId: string;
  projectName: string;
  accountId: string;
  threadId: string;
  sentAt: string;
  subject: string | null;
  /** The new part of their email, cut short. */
  excerpt: string;
}

type Row = Omit<CampaignReply, "sentAt" | "excerpt"> & { sentAt: Date; body: string | null; snippet: string | null };

export async function listCampaignReplies(limit = 20): Promise<CampaignReply[]> {
  const rows = await sql<Row[]>`
    with waiting as (
      select distinct on (c.id) c.id, c.name, o.name as org_name, p.id as project_id, p.name as project_name
        from contacts c
        join opportunities op on op.contact_id = c.id
        join projects p on p.id = op.project_id and p.sheet and not p.archived
        left join organizations o on o.id = op.organization_id
       where c.status <> 'archived'
         and c.last_inbound_at > coalesce(c.last_outbound_at, '-infinity'::timestamptz)
         and c.last_inbound_at > now() - interval '120 days'
         and (c.reply_dismissed_at is null or c.reply_dismissed_at < c.last_inbound_at)
       order by c.id, op.updated_at desc
    )
    select w.id as contact_id, w.name as contact_name, w.org_name as organization_name,
           w.project_id, w.project_name,
           m.account_id, m.gmail_thread_id as thread_id, m.sent_at, m.subject, m.body_text as body, m.snippet
      from waiting w
      cross join lateral (
        select m.*
          from messages m
          join message_participants mp on mp.message_id = m.id and mp.role = 'from'
          join contact_emails ce on ce.email = mp.email and ce.contact_id = w.id
         where m.direction = 'inbound' and not m.auto_reply and not coalesce(m.is_automated, false)
         order by m.sent_at desc
         limit 1
      ) m
     order by m.sent_at desc
     limit ${limit}`;
  return rows.map((r) => ({
    contactId: r.contactId,
    contactName: r.contactName,
    organizationName: r.organizationName,
    projectId: r.projectId,
    projectName: r.projectName,
    accountId: r.accountId,
    threadId: r.threadId,
    sentAt: r.sentAt.toISOString(),
    subject: r.subject,
    excerpt: newPart(r.body ?? r.snippet, 260),
  }));
}
