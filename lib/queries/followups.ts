import "server-only";
import { sql } from "@/lib/db";
import { AWAITING_REPLY_DAYS, OPEN_STAGES, REPLY_LOOKBACK_DAYS } from "@/lib/constants";
import { addDays } from "@/lib/dates";
import type { ContactSummary, FollowUps, Opportunity } from "@/lib/types";
import { clampLimit, contactSummaryColumns, contactSummaryJoins } from "@/lib/queries/shared";
import { opportunityColumns, opportunityJoins } from "@/lib/queries/opportunities";

/**
 * The follow-up lists (see docs/ARCHITECTURE.md → Follow-ups).
 * `today` is 'YYYY-MM-DD' in the owner's timezone. Archived contacts never appear.
 */
export async function getFollowUps(options: {
  today: string;
  /** Default AWAITING_REPLY_DAYS. */
  awaitingDays?: number;
  /** Default REPLY_LOOKBACK_DAYS. */
  lookbackDays?: number;
  /** Per list, default 50. */
  limit?: number;
  /** Include follow-ups due within this many days after today (default 0). */
  horizonDays?: number;
}): Promise<FollowUps> {
  const limit = clampLimit(options.limit, 50, 500);
  const until = addDays(options.today, Math.max(0, options.horizonDays ?? 0));
  const awaitingDays = options.awaitingDays ?? AWAITING_REPLY_DAYS;
  const lookbackDays = options.lookbackDays ?? REPLY_LOOKBACK_DAYS;

  const [due, needsReply, awaitingReply, opportunities] = await Promise.all([
    sql<ContactSummary[]>`
      select ${contactSummaryColumns()}
        from contacts c
        ${contactSummaryJoins()}
       where c.status <> 'archived'
         and c.follow_up_at is not null
         and c.follow_up_at <= ${until}::date
       order by c.follow_up_at, c.last_contacted_at desc nulls last
       limit ${limit}
    `,
    sql<ContactSummary[]>`
      select ${contactSummaryColumns()}
        from contacts c
        ${contactSummaryJoins()}
       where c.status <> 'archived'
         and c.last_inbound_at is not null
         and c.last_inbound_at > coalesce(c.last_outbound_at, '-infinity'::timestamptz)
         and c.last_inbound_at > now() - make_interval(days => ${lookbackDays}::int)
         and (c.reply_dismissed_at is null or c.reply_dismissed_at < c.last_inbound_at)
       order by c.last_inbound_at desc
       limit ${limit}
    `,
    sql<ContactSummary[]>`
      select ${contactSummaryColumns()}
        from contacts c
        ${contactSummaryJoins()}
       where c.status <> 'archived'
         and c.last_outbound_at is not null
         and c.last_outbound_at > coalesce(c.last_inbound_at, '-infinity'::timestamptz)
         and c.last_outbound_at < now() - make_interval(days => ${awaitingDays}::int)
         and c.last_outbound_at > now() - make_interval(days => ${lookbackDays}::int)
         and (c.reply_dismissed_at is null or c.reply_dismissed_at < c.last_outbound_at)
       order by c.last_outbound_at asc
       limit ${limit}
    `,
    sql<Opportunity[]>`
      select ${opportunityColumns()}
        from opportunities op
        ${opportunityJoins()}
       where op.stage = any(${OPEN_STAGES}::text[])
         and op.follow_up_at is not null
         and op.follow_up_at <= ${until}::date
       order by op.follow_up_at, op.updated_at desc
       limit ${limit}
    `,
  ]);

  return { due, needsReply, awaitingReply, opportunities };
}

/** Contacts with a follow-up date in (today, today + days], soonest first. */
export async function getUpcomingFollowUps(options: { today: string; days: number; limit?: number }): Promise<FollowUps["due"]> {
  return sql<ContactSummary[]>`
    select ${contactSummaryColumns()}
      from contacts c
      ${contactSummaryJoins()}
     where c.status <> 'archived'
       and c.follow_up_at > ${options.today}::date
       and c.follow_up_at <= ${addDays(options.today, options.days)}::date
     order by c.follow_up_at, c.last_contacted_at desc nulls last
     limit ${clampLimit(options.limit, 20, 200)}
  `;
}

/** One reminder for a later day: a contact's follow-up or a campaign row's / goal's. */
export interface ScheduledItem {
  kind: "contact" | "goal";
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** What to do (the follow-up note, or the goal's next step). */
  note: string | null;
  name: string;
  organization: string | null;
  contactId: string | null;
  opportunityId: string | null;
  campaign: { id: string; name: string; color: string } | null;
}

/**
 * Everything scheduled after today, soonest first (Today's "Scheduled"):
 * contacts' follow-ups and open goals' (campaign rows') follow-up dates, with
 * the campaign they belong to, so a "write to us in February" is never lost.
 */
export async function getScheduled(options: { today: string; limit?: number }): Promise<ScheduledItem[]> {
  const limit = clampLimit(options.limit, 60, 300);
  return sql<ScheduledItem[]>`
    select * from (
      select 'contact' as kind, c.id, c.follow_up_at::text as date, c.follow_up_note as note,
             coalesce(nullif(btrim(c.name), ''), (select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc limit 1), 'Contact') as name,
             o.name as organization, c.id as contact_id, null::uuid as opportunity_id,
             (select json_build_object('id', p.id, 'name', p.name, 'color', p.color) from projects p
               where p.sheet and not p.archived and (
                     exists (select 1 from opportunities op where op.project_id = p.id
                              and (op.contact_id = c.id or (c.organization_id is not null and op.organization_id = c.organization_id)))
                     or exists (select 1 from contact_projects cp where cp.project_id = p.id and cp.contact_id = c.id))
               order by p.name limit 1) as campaign
        from contacts c
        left join organizations o on o.id = c.organization_id
       where c.status <> 'archived' and c.follow_up_at > ${options.today}::date
      union all
      select 'goal', op.id, op.follow_up_at::text, op.next_step,
             coalesce(oc.name, oo.name, op.title), case when oc.name is not null then oo.name end,
             op.contact_id, op.id,
             case when p.sheet and not p.archived then json_build_object('id', p.id, 'name', p.name, 'color', p.color) end
        from opportunities op
        left join contacts oc on oc.id = op.contact_id
        left join organizations oo on oo.id = coalesce(op.organization_id, oc.organization_id)
        left join projects p on p.id = op.project_id
       where op.stage = any(${OPEN_STAGES}::text[]) and op.follow_up_at > ${options.today}::date
    ) s
    order by s.date, s.name
    limit ${limit}
  `;
}
