import "server-only";
import { sql } from "@/lib/db";
import {
  DEFAULT_EVENT_TIME_ZONE,
  type ListingCost,
  type ListingMethod,
  type PlatformKind,
  type PlatformTier,
  type SubmissionStatus,
} from "@/lib/listings/constants";
import type { PartnerRelationship } from "@/lib/listings/relationship";
import type { EmailMessage } from "@/lib/types";
import { clampLimit, messageColumns, toEmailMessage } from "./shared";

/**
 * Promotion: the partners and outlets every concert is sent to
 * (listing_platforms), the concerts we promote (listing_events) and, for
 * each concert, what was done on each one (listing_submissions).
 */

export interface ListingPlatform {
  id: string;
  name: string;
  kind: PlatformKind;
  tier: PlatformTier;
  website: string | null;
  submitUrl: string | null;
  email: string | null;
  method: ListingMethod;
  loginRequired: boolean;
  loginAccount: string | null;
  cost: ListingCost;
  costNote: string | null;
  leadDays: number | null;
  audience: string | null;
  fields: string | null;
  instructions: string | null;
  notes: string | null;
  /** Addresses or domains we talk to them from: their emails show on the card. */
  emailMatch: string[];
  relationship: PartnerRelationship | null;
}

export interface ListingEvent {
  id: string;
  title: string;
  startsAt: Date;
  timeZone: string;
  venue: string | null;
  address: string | null;
  ticketUrl: string | null;
  infoUrl: string | null;
  imageUrl: string | null;
  prices: string | null;
  description: string | null;
  notes: string | null;
}

export interface ListingSubmission {
  id: string;
  eventId: string;
  platformId: string;
  status: SubmissionStatus;
  sentAt: string | null;
  sentBy: string | null;
  confirmationUrl: string | null;
  publicUrl: string | null;
  notes: string | null;
  /** Why it is still pending (todo or blocked), as ChatGPT notes it. */
  pendingReason: string | null;
  /** Ticketing partners: tickets we offered, what their members pay, how many they took. */
  ticketsOffered: number | null;
  ticketsTaken: number | null;
  memberPrice: string | null;
  updatedAt: Date;
}

export interface EventSummary extends ListingEvent {
  counts: Partial<Record<SubmissionStatus, number>>;
}

/** A platform with what happened on it for one concert (no row yet = to do). */
export interface PlatformForEvent extends ListingPlatform {
  submission: ListingSubmission | null;
}

const platformColumns = sql`
  p.id, p.name, p.kind, p.tier, p.website, p.submit_url, p.email, p.method, p.login_required, p.login_account,
  p.cost, p.cost_note, p.lead_days, p.audience, p.fields, p.instructions, p.notes, p.email_match, p.relationship
`;

const eventColumns = sql`
  e.id, e.title, e.starts_at, e.time_zone, e.venue, e.address, e.ticket_url, e.info_url, e.image_url,
  e.prices, e.description, e.notes
`;

export async function listListingEvents(): Promise<EventSummary[]> {
  const rows = await sql<(ListingEvent & { counts: Record<string, number> | null })[]>`
    select ${eventColumns},
      (select jsonb_object_agg(status, n) from (
        select status, count(*)::int n from listing_submissions s where s.event_id = e.id group by status
      ) c) as counts
    from listing_events e
    order by e.starts_at desc`;
  return rows.map((r) => ({ ...r, counts: r.counts ?? {} }));
}

export async function getListingEvent(id: string): Promise<ListingEvent | null> {
  const [row] = await sql<ListingEvent[]>`select ${eventColumns} from listing_events e where e.id = ${id}`;
  return row ?? null;
}

/** Every platform (every-concert ones first, by kind and name) with this concert's submission, when there is one. */
export async function platformsForEvent(eventId: string | null): Promise<PlatformForEvent[]> {
  const rows = await sql<(ListingPlatform & { submission: ListingSubmission | null })[]>`
    select ${platformColumns},
      (select to_jsonb(s) from (
        select s.id, s.event_id, s.platform_id, s.status, s.sent_at, s.sent_by, s.confirmation_url,
               s.public_url, s.notes, s.pending_reason, s.tickets_offered, s.tickets_taken, s.member_price, s.updated_at
        from listing_submissions s where s.platform_id = p.id and s.event_id = ${eventId}
      ) s) as submission
    from listing_platforms p
    order by case p.tier when 'always' then 0 when 'sometimes' then 1 else 2 end, case p.kind when 'partner' then 0 when 'editorial' then 1 when 'calendar' then 2 when 'newsletter' then 3 when 'aggregator' then 4 else 5 end, lower(p.name)`;
  return rows.map((r) => ({ ...r, submission: r.submission ? toSubmission(r.submission as unknown as Record<string, unknown>) : null }));
}

/** The nested json row (its keys may arrive in snake_case or camelCase, depending on the driver's transform). */
function toSubmission(raw: Record<string, unknown>): ListingSubmission {
  const get = (snake: string) => raw[snake] ?? raw[snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] ?? null;
  return {
    id: get("id") as string,
    eventId: get("event_id") as string,
    platformId: get("platform_id") as string,
    status: get("status") as SubmissionStatus,
    sentAt: get("sent_at") as string | null,
    sentBy: get("sent_by") as string | null,
    confirmationUrl: get("confirmation_url") as string | null,
    publicUrl: get("public_url") as string | null,
    notes: get("notes") as string | null,
    pendingReason: get("pending_reason") as string | null,
    ticketsOffered: get("tickets_offered") as number | null,
    ticketsTaken: get("tickets_taken") as number | null,
    memberPrice: get("member_price") as string | null,
    updatedAt: new Date(get("updated_at") as string),
  };
}

export async function listListingPlatforms(): Promise<ListingPlatform[]> {
  return sql<ListingPlatform[]>`select ${platformColumns} from listing_platforms p order by case p.tier when 'always' then 0 when 'sometimes' then 1 else 2 end, case p.kind when 'partner' then 0 when 'editorial' then 1 when 'calendar' then 2 when 'newsletter' then 3 when 'aggregator' then 4 else 5 end, lower(p.name)`;
}

export interface PlatformInput {
  name: string;
  kind?: PlatformKind;
  tier?: PlatformTier;
  website?: string | null;
  submitUrl?: string | null;
  email?: string | null;
  method?: ListingMethod;
  loginRequired?: boolean;
  loginAccount?: string | null;
  cost?: ListingCost;
  costNote?: string | null;
  leadDays?: number | null;
  audience?: string | null;
  fields?: string | null;
  instructions?: string | null;
  notes?: string | null;
  emailMatch?: string[];
  relationship?: PartnerRelationship | null;
}

/** Creates the platform, or updates the one with that id. Only the fields given change on an update. */
export async function savePlatform(input: PlatformInput, id?: string): Promise<string> {
  const values = {
    name: input.name.trim(),
    kind: input.kind ?? "calendar",
    tier: input.tier ?? "sometimes",
    website: input.website ?? null,
    submit_url: input.submitUrl ?? null,
    email: input.email ?? null,
    method: input.method ?? "form",
    login_required: input.loginRequired ?? false,
    login_account: input.loginAccount ?? null,
    cost: input.cost ?? "unknown",
    cost_note: input.costNote ?? null,
    lead_days: input.leadDays ?? null,
    audience: input.audience ?? null,
    fields: input.fields ?? null,
    instructions: input.instructions ?? null,
    notes: input.notes ?? null,
    email_match: input.emailMatch ?? [],
    relationship: input.relationship ? sql.json(input.relationship as never) : null,
  };
  if (id) {
    const keys = Object.keys(values).filter((k) => {
      const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof PlatformInput;
      return k === "name" || input[camel] !== undefined;
    }) as (keyof typeof values)[];
    const [row] = await sql<{ id: string }[]>`
      update listing_platforms set ${sql(values, keys)} where id = ${id} returning id`;
    if (!row) throw new Error("That platform no longer exists.");
    return row.id;
  }
  const [row] = await sql<{ id: string }[]>`insert into listing_platforms ${sql(values)} returning id`;
  return row.id;
}

export async function findPlatformByName(name: string): Promise<ListingPlatform | null> {
  const [row] = await sql<ListingPlatform[]>`
    select ${platformColumns} from listing_platforms p where lower(p.name) = lower(${name.trim()})`;
  return row ?? null;
}

export async function deletePlatform(id: string): Promise<void> {
  await sql`delete from listing_platforms where id = ${id}`;
}

export interface EventInput {
  title: string;
  /** Local date and time where the concert happens. */
  date: string;
  time: string;
  timeZone?: string;
  venue?: string | null;
  address?: string | null;
  ticketUrl?: string | null;
  infoUrl?: string | null;
  imageUrl?: string | null;
  prices?: string | null;
  description?: string | null;
  notes?: string | null;
}

export async function saveEvent(input: EventInput, id?: string): Promise<string> {
  const tz = input.timeZone || DEFAULT_EVENT_TIME_ZONE;
  const values = {
    title: input.title.trim(),
    time_zone: tz,
    venue: input.venue ?? null,
    address: input.address ?? null,
    ticket_url: input.ticketUrl ?? null,
    info_url: input.infoUrl ?? null,
    image_url: input.imageUrl ?? null,
    prices: input.prices ?? null,
    description: input.description ?? null,
    notes: input.notes ?? null,
  };
  const startsAt = sql`((${input.date}::date + ${input.time}::time) at time zone ${tz})`;
  if (id) {
    const [row] = await sql<{ id: string }[]>`
      update listing_events set ${sql(values)}, starts_at = ${startsAt} where id = ${id} returning id`;
    if (!row) throw new Error("That concert no longer exists.");
    return row.id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into listing_events (title, time_zone, venue, address, ticket_url, info_url, image_url, prices, description, notes, starts_at)
    values (${values.title}, ${values.time_zone}, ${values.venue}, ${values.address}, ${values.ticket_url}, ${values.info_url},
            ${values.image_url}, ${values.prices}, ${values.description}, ${values.notes}, ${startsAt})
    returning id`;
  return row.id;
}

export interface SubmissionInput {
  status?: SubmissionStatus;
  sentAt?: string | null;
  sentBy?: string | null;
  confirmationUrl?: string | null;
  publicUrl?: string | null;
  notes?: string | null;
  pendingReason?: string | null;
  ticketsOffered?: number | null;
  ticketsTaken?: number | null;
  memberPrice?: string | null;
}

/**
 * The submission of a concert on a platform: created on first change, then
 * only the given fields change. Marking it sent (or further) without a date
 * records today, and never overwrites a date already there.
 */
export async function saveSubmission(eventId: string, platformId: string, input: SubmissionInput): Promise<string> {
  const defaultDate = input.sentAt === undefined && input.status !== undefined && input.status !== "todo" && input.status !== "skipped";
  const has = {
    status: input.status !== undefined,
    sentAt: input.sentAt !== undefined,
    sentBy: input.sentBy !== undefined,
    confirmationUrl: input.confirmationUrl !== undefined,
    publicUrl: input.publicUrl !== undefined,
    notes: input.notes !== undefined,
    pendingReason: input.pendingReason !== undefined,
    ticketsOffered: input.ticketsOffered !== undefined,
    ticketsTaken: input.ticketsTaken !== undefined,
    memberPrice: input.memberPrice !== undefined,
  };
  const [row] = await sql<{ id: string }[]>`
    insert into listing_submissions (event_id, platform_id, status, sent_at, sent_by, confirmation_url, public_url, notes,
                                     pending_reason, tickets_offered, tickets_taken, member_price)
    values (${eventId}, ${platformId}, ${input.status ?? "todo"},
            ${defaultDate ? sql`current_date` : sql`${input.sentAt ?? null}::date`},
            ${input.sentBy ?? null}, ${input.confirmationUrl ?? null}, ${input.publicUrl ?? null}, ${input.notes ?? null},
            ${input.pendingReason ?? null}, ${input.ticketsOffered ?? null}, ${input.ticketsTaken ?? null}, ${input.memberPrice ?? null})
    on conflict (event_id, platform_id) do update set
      status = case when ${has.status} then excluded.status else listing_submissions.status end,
      sent_at = case when ${has.sentAt} then excluded.sent_at
                     when ${defaultDate} then coalesce(listing_submissions.sent_at, excluded.sent_at)
                     else listing_submissions.sent_at end,
      sent_by = case when ${has.sentBy} then excluded.sent_by else listing_submissions.sent_by end,
      confirmation_url = case when ${has.confirmationUrl} then excluded.confirmation_url else listing_submissions.confirmation_url end,
      public_url = case when ${has.publicUrl} then excluded.public_url else listing_submissions.public_url end,
      notes = case when ${has.notes} then excluded.notes else listing_submissions.notes end,
      pending_reason = case when ${has.pendingReason} then excluded.pending_reason else listing_submissions.pending_reason end,
      tickets_offered = case when ${has.ticketsOffered} then excluded.tickets_offered else listing_submissions.tickets_offered end,
      tickets_taken = case when ${has.ticketsTaken} then excluded.tickets_taken else listing_submissions.tickets_taken end,
      member_price = case when ${has.memberPrice} then excluded.member_price else listing_submissions.member_price end
    returning id`;
  return row.id;
}

/**
 * A partner's emails, in the same shape as a contact's or an organization's
 * correspondence: every message from or to one of its addresses (entries
 * with @) or domains, newest first, one copy per message across accounts.
 */
export async function partnerHistory(emailMatch: string[], limit = 30): Promise<EmailMessage[]> {
  const items = emailMatch.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!items.length) return [];
  const addresses = items.filter((e) => e.includes("@"));
  const domains = items.filter((e) => !e.includes("@"));
  const rows = await sql`
    with ids as (
      select mp.message_id
        from message_participants mp
       where (mp.email = any(${addresses}) or split_part(mp.email, '@', 2) = any(${domains}))
         and mp.email not in (select email from self_addresses)
    ),
    picked as (
      select distinct on (coalesce(m.rfc822_message_id, m.id::text)) m.id
        from ids
        join messages m on m.id = ids.message_id
       order by coalesce(m.rfc822_message_id, m.id::text), (m.direction = 'inbound'), m.created_at, m.id
    )
    select ${messageColumns()}
      from picked p
      join messages m on m.id = p.id
      join gmail_accounts a on a.id = m.account_id
     order by m.sent_at desc, m.id
     limit ${clampLimit(limit, 30)}
  `;
  return rows.map((row) => toEmailMessage(row as never));
}
