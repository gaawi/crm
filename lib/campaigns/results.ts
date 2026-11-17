import "server-only";
import { sql } from "@/lib/db";

/** What a mailing got back: real replies, bounces and automatic replies to the emails it sent. */
export interface CampaignResults {
  sent: number;
  replied: number;
  bounced: number;
  autoReplies: number;
}

/**
 * Results per mailing. A reply counts when the person (any address of the
 * draft's contact, or an address it was sent to) wrote a real email after it;
 * a bounce when a delivery failure named the address after it.
 */
export async function campaignResults(campaignIds: string[]): Promise<Record<string, CampaignResults>> {
  if (!campaignIds.length) return {};
  const rows = await sql<({ campaignId: string } & CampaignResults)[]>`
    with sent as (
      select d.campaign_id, d.sent_at,
             array(select unnest(d.to_emails)
                   union select ce.email from contact_emails ce where ce.contact_id = d.contact_id) as emails
        from email_drafts d
       where d.campaign_id = any(${campaignIds}::uuid[]) and d.status = 'sent' and d.sent_at is not null
    )
    select s.campaign_id,
           count(*)::int as sent,
           count(*) filter (where exists (
             select 1 from messages m join message_participants mp on mp.message_id = m.id and mp.role = 'from'
              where mp.email = any(s.emails) and m.direction = 'inbound' and m.sent_at > s.sent_at
                and not m.auto_reply and not coalesce(m.is_automated, false)))::int as replied,
           count(*) filter (where exists (
             select 1 from contact_emails ce where ce.email = any(s.emails) and ce.bounced_at > s.sent_at))::int as bounced,
           count(*) filter (where exists (
             select 1 from messages m join message_participants mp on mp.message_id = m.id and mp.role = 'from'
              where mp.email = any(s.emails) and m.direction = 'inbound' and m.sent_at > s.sent_at and m.auto_reply))::int as auto_replies
      from sent s
     group by s.campaign_id`;
  return Object.fromEntries(rows.map(({ campaignId, ...r }) => [campaignId, r]));
}

/** "6 replied (7%) · 2 bounced" (empty before anything was sent). */
export function resultsLine(r: CampaignResults | undefined): string {
  if (!r || !r.sent) return "";
  const pct = Math.round((r.replied / r.sent) * 100);
  return [
    `${r.replied} replied (${pct}%)`,
    r.bounced ? `${r.bounced} bounced` : "",
    r.autoReplies ? `${r.autoReplies} auto-replies` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
