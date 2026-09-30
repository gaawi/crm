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
