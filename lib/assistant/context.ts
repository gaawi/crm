import "server-only";
import { cardMissing, type CardField } from "@/lib/contacts/card";
import { sql } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { MAX_EMAILS_PER_CALL } from "@/lib/assistant/types";
import { OPEN_DRAFT_STATUSES, releasePostponed } from "@/lib/queries/assistant";

/**
 * What the daily routine reads (GET /api/assistant-agent/context): every
 * active booking sheet with its brief, rows, recent correspondence and
 * activities, what is already proposed (so it never duplicates) and the
 * emails the owner asked to change. Bounded: at most MAX_ROWS rows per
 * sheet, 5 emails and 5 activities per row, texts truncated.
 */

const MAX_ROWS = 150;
const MAX_SHEETS = 20;

const clip = (value: string | null | undefined, max: number): string | null => {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const iso = (value: Date | string | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

interface SheetRowCtx {
  opportunityId: string;
  title: string;
  goal: string;
  stage: string;
  nextAction: string | null;
  nextStep: string | null;
  followUpAt: string | null;
  notes: string | null;
  eventDates: string | null;
  section: string | null;
  organization: { name: string; city: string | null } | null;
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    role: string | null;
    /** When the card was filled (POST /api/assistant-agent/contacts); null = fill it before proposing an email. */
    researchedAt: string | null;
    /** What the card still lacks ("role", "phone", "organizationProfile"…). */
    cardMissing: CardField[];
  } | null;
  emails: { direction: string; date: string; subject: string | null; snippet: string | null }[];
  activities: { kind: string; outcome: string | null; date: string; note: string | null }[];
  openDraft: { id: string; status: string } | null;
}

export interface AssistantContext {
  generatedAt: string;
  today: string;
  timezone: string;
  limits: { maxEmailsPerProjectPerCall: number };
  /**
   * What the owner corrected in earlier emails ("Request changes"), newest
   * first: standing lessons on tone, facts and how to present us, to apply to
   * every email, not only the one they were written for.
   */
  ownerLessons: { date: string; contact: string | null; campaign: string | null; request: string }[];
  projects: {
    id: string;
    name: string;
    description: string | null;
    brief: string | null;
    currency: string;
    sendAccount: string | null;
    lastRunAt: string | null;
    stageCounts: Record<string, number>;
    rows: SheetRowCtx[];
    truncatedRows: boolean;
    openActions: { id: string; opportunityId: string | null; kind: string; title: string; status: string; postponedUntil: string | null; createdAt: string }[];
    pendingDrafts: { id: string; opportunityId: string | null; status: string; subject: string; postponedUntil: string | null; createdAt: string }[];
    changesRequested: { draftId: string; opportunityId: string | null; to: string[]; revisionRequest: string | null; subject: string; body: string }[];
    templates: { id: string; name: string; trigger: string; subject: string; body: string }[];
  }[];
}

export async function buildAssistantContext(now: Date = new Date()): Promise<AssistantContext> {
  const timezone = env.timezone;
  const today = todayIn(timezone, now);
  await releasePostponed(today);

  const sheets = await sql<
    { id: string; name: string; description: string | null; brief: string | null; currency: string; sendAccount: string | null; lastRunAt: Date | null }[]
  >`
    select p.id, p.name, p.description, p.assistant_brief as brief, p.currency, a.email as send_account, p.assistant_last_run_at as last_run_at
      from projects p
      left join gmail_accounts a on a.id = p.send_account_id
     where p.sheet and not p.archived and p.assistant_active
     order by p.sort_order, p.name
     limit ${MAX_SHEETS}`;

  const projects: AssistantContext["projects"] = [];
  for (const sheet of sheets) {
    const rows = await sql<
      (Omit<SheetRowCtx, "emails" | "activities" | "contact"> & {
        contact:
          | (Omit<NonNullable<SheetRowCtx["contact"]>, "cardMissing"> & {
              organizationId: string | null;
              organizationHasProfile: boolean;
              photoUrl: string | null;
            })
          | null;
        emails: { direction: string; date: string; subject: string | null; snippet: string | null }[] | null;
        activities: { kind: string; outcome: string | null; date: string; note: string | null }[] | null;
      })[]
    >`
      select op.id as opportunity_id, op.title, op.kind as goal, op.stage, op.next_action, op.next_step,
             op.follow_up_at::text as follow_up_at, op.notes, op.event_dates, op.sheet_section as section,
             case when o.id is null then null else json_build_object('name', o.name, 'city', o.city) end as organization,
             case when c.id is null then null else json_build_object(
               'id', c.id, 'name', nullif(btrim(c.name), ''), 'email', e.email, 'phone', c.phone, 'whatsapp', c.whatsapp,
               'role', nullif(btrim(c.role), ''), 'researchedAt', c.researched_at, 'organizationId', c.organization_id,
               'organizationHasProfile', co.profile is not null, 'photoUrl', c.photo_url) end as contact,
             em.emails, ac.activities,
             (select json_build_object('id', d.id, 'status', d.status) from email_drafts d
               where (d.opportunity_id = op.id or (c.id is not null and d.contact_id = c.id))
                 and d.status = any(${OPEN_DRAFT_STATUSES}::text[])
               order by d.created_at desc limit 1) as open_draft
        from opportunities op
        left join organizations o on o.id = op.organization_id
        left join contacts c on c.id = op.contact_id
        left join organizations co on co.id = c.organization_id
        left join lateral (
          select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1
        ) e on true
        left join lateral (
          select json_agg(json_build_object('direction', x.direction, 'date', x.sent_at, 'subject', x.subject,
                   'snippet', left(regexp_replace(coalesce(nullif(x.body_text, ''), x.snippet, ''), '\\s+', ' ', 'g'), 400))
                   order by x.sent_at desc) as emails
            from (select m.direction, m.sent_at, m.subject, left(m.body_text, 2000) as body_text, m.snippet
                    from contact_emails ce
                    join message_participants mp on mp.email = ce.email
                    join messages m on m.id = mp.message_id
                   where ce.contact_id = c.id and not m.is_automated
                   group by m.id
                   order by m.sent_at desc
                   limit 5) x
        ) em on true
        left join lateral (
          select json_agg(json_build_object('kind', y.kind, 'outcome', y.outcome, 'date', y.occurred_at, 'note', left(y.body, 300))
                   order by y.occurred_at desc) as activities
            from (select a.kind, a.outcome, a.occurred_at, a.body from activities a
                   where a.opportunity_id = op.id or (c.id is not null and a.contact_id = c.id)
                   order by a.occurred_at desc limit 5) y
        ) ac on true
       where op.project_id = ${sheet.id}
       order by array_position(array['negotiation','proposal','contacted','lead','won','lost']::text[], op.stage),
                op.follow_up_at asc nulls last
       limit ${MAX_ROWS + 1}`;

    const [counts] = await sql<{ counts: Record<string, number> | null }[]>`
      select json_object_agg(stage, n) as counts from (select stage, count(*)::int as n from opportunities where project_id = ${sheet.id} group by stage) s`;

    const actions = await sql<{ id: string; opportunityId: string | null; kind: string; title: string; status: string; postponedUntil: string | null; createdAt: Date }[]>`
      select id, opportunity_id, kind, title, status, postponed_until, created_at from assistant_actions
       where project_id = ${sheet.id} and status in ('open', 'postponed')
       order by priority, created_at desc limit 200`;

    const drafts = await sql<
      {
        id: string;
        opportunityId: string | null;
        status: string;
        subject: string;
        body: string;
        to: string[];
        revisionRequest: string | null;
        postponedUntil: string | null;
        createdAt: Date;
      }[]
    >`
      select distinct d.id, d.opportunity_id, d.status, d.subject, d.body_text as body, d.to_emails as "to", d.revision_request,
             d.postponed_until, d.created_at
        from email_drafts d
        left join opportunities op on op.id = d.opportunity_id
       where d.status = any(${OPEN_DRAFT_STATUSES}::text[])
         and (op.project_id = ${sheet.id}
              or exists (select 1 from assistant_actions aa where aa.draft_id = d.id and aa.project_id = ${sheet.id}))
       order by d.created_at desc
       limit 300`;

    const templates = await sql<{ id: string; name: string; trigger: string; subject: string; body: string }[]>`
      select id, name, trigger, subject, body from email_templates
       where project_id = ${sheet.id} or project_id is null
       order by (project_id is null), sort_order, lower(name) limit 30`;

    projects.push({
      id: sheet.id,
      name: sheet.name,
      description: clip(sheet.description, 1000),
      brief: sheet.brief,
      currency: sheet.currency,
      sendAccount: sheet.sendAccount,
      lastRunAt: iso(sheet.lastRunAt),
      stageCounts: counts?.counts ?? {},
      truncatedRows: rows.length > MAX_ROWS,
      rows: rows.slice(0, MAX_ROWS).map((r) => ({
        ...r,
        contact: r.contact
          ? {
              id: r.contact.id,
              name: r.contact.name,
              email: r.contact.email,
              phone: r.contact.phone,
              whatsapp: r.contact.whatsapp,
              role: r.contact.role,
              researchedAt: iso(r.contact.researchedAt),
              cardMissing: cardMissing(r.contact),
            }
          : null,
        nextStep: clip(r.nextStep, 300),
        notes: clip(r.notes, 500),
        eventDates: clip(r.eventDates, 200),
        emails: (r.emails ?? []).map((m) => ({ ...m, date: iso(m.date)!, subject: clip(m.subject, 200), snippet: clip(m.snippet, 400) })),
        activities: (r.activities ?? []).map((a) => ({ ...a, date: iso(a.date)!, note: clip(a.note, 300) })),
      })),
      openActions: actions.map((a) => ({ ...a, createdAt: iso(a.createdAt)! })),
      pendingDrafts: drafts
        .filter((d) => d.status !== "changes_requested")
        .map((d) => ({ id: d.id, opportunityId: d.opportunityId, status: d.status, subject: d.subject, postponedUntil: d.postponedUntil, createdAt: iso(d.createdAt)! })),
      changesRequested: drafts
        .filter((d) => d.status === "changes_requested")
        .map((d) => ({ draftId: d.id, opportunityId: d.opportunityId, to: d.to, revisionRequest: d.revisionRequest, subject: d.subject, body: d.body.slice(0, 20_000) })),
      templates: templates.map((t) => ({ ...t, body: t.body.slice(0, 4000) })),
    });
  }

  const lessons = await sql<{ date: Date; contact: string | null; campaign: string | null; request: string }[]>`
    select (r->>'at')::timestamptz as date, nullif(btrim(c.name), '') as contact, p.name as campaign, r->>'note' as request
      from email_drafts d
      cross join lateral jsonb_array_elements(d.revisions) r
      left join contacts c on c.id = d.contact_id
      left join opportunities op on op.id = d.opportunity_id
      left join projects p on p.id = op.project_id
     where nullif(btrim(r->>'note'), '') is not null and (r->>'at')::timestamptz > now() - interval '120 days'
     order by 1 desc
     limit 80`;

  return {
    generatedAt: now.toISOString(),
    today,
    timezone,
    limits: { maxEmailsPerProjectPerCall: MAX_EMAILS_PER_CALL },
    ownerLessons: lessons.map((l) => ({ date: iso(l.date)!, contact: l.contact, campaign: l.campaign, request: clip(l.request, 2000)! })),
    projects,
  };
}
