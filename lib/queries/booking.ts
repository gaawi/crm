import "server-only";
import { sql, type Tx } from "@/lib/db";
import { FOLLOW_UP_OVERDUE_DAYS, GOAL_KINDS, stageLabel } from "@/lib/constants";
import { parseSheetImport } from "@/lib/booking/csv-import";
import { normalizeFee } from "@/lib/booking/fee";
import { normalizePrefix } from "@/lib/booking/phone";
import type { BookingSheet, ImportResult, SendAccount, SheetRow, SheetRowInput } from "@/lib/booking/types";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { cleanPhone, createContact, getContactByEmail } from "@/lib/queries/contacts";
import { checkGoalValues, createOpportunity, parseMoney } from "@/lib/queries/opportunities";
import { findOrCreateOrganization } from "@/lib/queries/organizations";
import { readProfile } from "@/lib/organizations/profile";
import { createProject, updateProject } from "@/lib/queries/projects";
import type { NextAction, OpportunityKind, OpportunityStage, OrganizationKind } from "@/lib/types";
import { errorMessage, isValidEmail, normalizeEmail } from "@/lib/utils";

/**
 * Booking sheets: projects flagged `sheet`, whose rows are the project's
 * opportunities (goals: "booking" by default, any goal kind allowed) with
 * their organization and contact. Types the client receives live in
 * lib/booking/types.ts.
 */

export type { BookingSheet, SheetRow, SheetRowInput } from "@/lib/booking/types";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sheet columns plus per-stage counts, from `projects p` left-joined to its rows `op` and their contacts `c`. */
const sheetColumns = (today: string, timezone: string) => sql`
  p.id, p.name, p.color, p.description, p.currency, p.phone_prefix, p.send_account_id,
  coalesce(array_agg(distinct op.kind order by op.kind) filter (where op.id is not null), '{}') as kinds,
  count(op.id)::int as rows,
  count(op.id) filter (where op.stage not in ('won', 'lost'))::int as open,
  count(op.id) filter (where op.stage = 'won')::int as confirmed,
  count(op.id) filter (where op.stage = 'lost')::int as declined,
  count(op.id) filter (where op.stage not in ('won', 'lost') and op.follow_up_at <= ${today}::date)::int as follow_ups_due,
  count(op.id) filter (
    where op.stage in ('contacted', 'proposal')
      and c.awaiting_reply_since is not null
      and ${today}::date - (c.awaiting_reply_since at time zone ${timezone})::date > ${FOLLOW_UP_OVERDUE_DAYS}::int
  )::int as no_reply,
  json_build_object(
    'toContact', count(op.id) filter (where op.stage = 'lead'),
    'contacted', count(op.id) filter (where op.stage = 'contacted'),
    'proposal', count(op.id) filter (where op.stage = 'proposal'),
    'inConversation', count(op.id) filter (where op.stage = 'negotiation'),
    'confirmed', count(op.id) filter (where op.stage = 'won'),
    'declined', count(op.id) filter (where op.stage = 'lost')
  ) as counts
`;

const sheetJoins = () => sql`
  left join opportunities op on op.project_id = p.id
  left join contacts c on c.id = op.contact_id
`;

/** Every sheet that is not archived, with counts (`today` = 'YYYY-MM-DD' in the owner's timezone). */
export async function listSheets(today: string = todayIn(env.timezone)): Promise<BookingSheet[]> {
  return sql<BookingSheet[]>`
    select ${sheetColumns(today, env.timezone)}
      from projects p
      ${sheetJoins()}
     where p.sheet and not p.archived
     group by p.id
     order by p.sort_order, p.name
  `;
}

export async function getSheet(id: string, today: string = todayIn(env.timezone)): Promise<BookingSheet | null> {
  if (!ID.test(id)) return null;
  const [row] = await sql<BookingSheet[]>`
    select ${sheetColumns(today, env.timezone)}
      from projects p
      ${sheetJoins()}
     where p.id = ${id} and p.sheet
     group by p.id
  `;
  return row ?? null;
}

const STAGE_ORDER = ["negotiation", "proposal", "contacted", "lead", "won", "lost"];

const iso = (value: string | Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

type RawSheetRow = Omit<SheetRow, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date };

function toSheetRow(row: RawSheetRow): SheetRow {
  return {
    ...row,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    organization: row.organization ? { ...row.organization, profile: readProfile(row.organization.profile) } : null,
    contact: row.contact
      ? {
          ...row.contact,
          lastContactedAt: iso(row.contact.lastContactedAt),
          lastInboundAt: iso(row.contact.lastInboundAt),
          lastOutboundAt: iso(row.contact.lastOutboundAt),
          awaitingReplySince: iso(row.contact.awaitingReplySince),
        }
      : null,
    lastActivity: row.lastActivity ? { ...row.lastActivity, occurredAt: iso(row.lastActivity.occurredAt)! } : null,
    lastCall: row.lastCall ? { ...row.lastCall, occurredAt: iso(row.lastCall.occurredAt)! } : null,
  };
}

/**
 * Rows: open ones by how far along they are, then confirmed, then declined;
 * follow-ups due first within a stage. Activities count for the row and for
 * its contact (a call logged on the contact page shows here too).
 */
export async function getSheetRows(projectId: string, options: { ids?: string[] } = {}): Promise<SheetRow[]> {
  if (!ID.test(projectId)) return [];
  const rows = await sql<RawSheetRow[]>`
    select op.id, op.title, op.kind, op.stage, op.value, op.currency, op.follow_up_at, op.next_action, op.next_step, op.notes, op.event_dates,
           op.sheet_section as section, op.spaces, op.is_returning as "returning", op.created_at, op.updated_at,
           case when o.id is null then null else json_build_object('id', o.id, 'name', o.name, 'city', o.city, 'website', o.website, 'profile', o.profile) end as organization,
           case when c.id is null then null else json_build_object(
             'id', c.id,
             'name', nullif(btrim(c.name), ''),
             'displayName', coalesce(nullif(btrim(c.name), ''), e.email, 'Unknown'),
             'role', c.role,
             'email', e.email,
             'phone', c.phone,
             'whatsapp', c.whatsapp,
             'lastContactedAt', c.last_contacted_at,
             'lastInboundAt', c.last_inbound_at,
             'lastOutboundAt', c.last_outbound_at,
             'awaitingReplySince', c.awaiting_reply_since,
             'openDraftId', (select d.id from email_drafts d
                              where d.contact_id = c.id and d.status in ('proposed', 'queued', 'revising', 'sending', 'failed')
                              order by d.created_at desc limit 1)) end as contact,
           la.last_activity, lc.last_call, coalesce(ac.n, 0) as activity_count
      from opportunities op
      join projects sp on sp.id = op.project_id and sp.sheet
      left join organizations o on o.id = op.organization_id
      left join contacts c on c.id = op.contact_id
      left join lateral (
        select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1
      ) e on true
      left join lateral (
        select json_build_object('kind', a.kind, 'outcome', a.outcome, 'occurredAt', a.occurred_at, 'body', a.body) as last_activity
          from activities a
         where a.kind <> 'status' and (a.opportunity_id = op.id or a.contact_id = op.contact_id)
         order by a.occurred_at desc, a.created_at desc
         limit 1
      ) la on true
      left join lateral (
        select json_build_object('outcome', a.outcome, 'occurredAt', a.occurred_at) as last_call
          from activities a
         where a.kind = 'call' and (a.opportunity_id = op.id or a.contact_id = op.contact_id)
         order by a.occurred_at desc, a.created_at desc
         limit 1
      ) lc on true
      left join lateral (
        select count(*)::int as n
          from activities a
         where a.kind <> 'status' and (a.opportunity_id = op.id or a.contact_id = op.contact_id)
      ) ac on true
     where op.project_id = ${projectId}
       ${options.ids ? sql`and op.id = any(${options.ids}::uuid[])` : sql``}
     order by array_position(${STAGE_ORDER}::text[], op.stage), op.follow_up_at asc nulls last, lower(coalesce(o.name, op.title))
  `;
  return rows.map(toSheetRow);
}

export async function createSheet(input: {
  name: string;
  currency?: string;
  description?: string | null;
  phonePrefix?: string | null;
}): Promise<string> {
  const id = await createProject({ name: input.name, description: input.description ?? null });
  const currency = (input.currency ?? "USD").trim().toUpperCase();
  await sql`
    update projects
       set sheet = true,
           currency = ${/^[A-Z]{3}$/.test(currency) ? currency : "USD"},
           phone_prefix = ${normalizePrefix(input.phonePrefix)}
     where id = ${id}`;
  return id;
}

export interface SheetSettings {
  name?: string;
  /** ISO 4217, e.g. "EUR". */
  currency?: string;
  description?: string | null;
  /** "+34", "34" or "0034"; "" / null clears. */
  phonePrefix?: string | null;
  /** A Gmail account id; null = the first connected account. */
  sendAccountId?: string | null;
}

/** Patch semantics. Existing rows keep their currency; new rows use the sheet's. */
export async function updateSheetSettings(id: string, patch: SheetSettings): Promise<void> {
  const [sheet] = await sql`select 1 from projects where id = ${id} and sheet`;
  if (!sheet) throw new Error("Booking sheet not found");
  const values: Record<string, unknown> = {};
  if (patch.currency !== undefined) {
    const currency = patch.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter currency code, e.g. EUR.");
    values.currency = currency;
  }
  if ("phonePrefix" in patch) {
    const raw = patch.phonePrefix?.trim() ?? "";
    const prefix = raw ? normalizePrefix(raw) : null;
    if (raw && !prefix) throw new Error("Use a country code like +34 or +1.");
    values.phonePrefix = prefix;
  }
  if ("sendAccountId" in patch) {
    const accountId = patch.sendAccountId || null;
    if (accountId) {
      const [account] = await sql`select 1 from gmail_accounts where id = ${accountId}`;
      if (!account) throw new Error("That Gmail account is not connected.");
    }
    values.sendAccountId = accountId;
  }
  if (patch.name !== undefined || "description" in patch) {
    await updateProject(id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...("description" in patch ? { description: patch.description ?? null } : {}),
    });
  }
  if (Object.keys(values).length) await sql`update projects set ${sql(values as never)} where id = ${id}`;
}

/** Gmail accounts emails can be prepared from (not disconnected), active first. */
export async function listSendAccounts(): Promise<SendAccount[]> {
  return sql<SendAccount[]>`
    select id, email, display_name, status from gmail_accounts
     where status <> 'disconnected'
     order by (status = 'active') desc, created_at
  `;
}

/* Rows --------------------------------------------------------------------- */

export interface NewSheetRow extends SheetRowInput {
  projectId: string;
}

function oneLine(value: string | null | undefined, max = 300): string | null {
  const clean = (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return clean || null;
}

/** "4.500 €" → "4500.00"; "" → null; not an amount → an error. */
function feeValue(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const fee = normalizeFee(raw);
  if (fee === null) throw new Error("Fee must be a number.");
  return parseMoney(fee);
}

/** A section as the sheet already spells it ("cultura en rede" → "Cultura en Rede"), else as typed. */
async function resolveSection(db: Tx | typeof sql, projectId: string, raw: string | null | undefined): Promise<string | null> {
  const section = oneLine(raw, 120);
  if (!section) return null;
  const [existing] = await db<{ sheetSection: string }[]>`
    select sheet_section from opportunities
     where project_id = ${projectId} and lower(sheet_section) = lower(${section})
     order by created_at limit 1
  `;
  return existing?.sheetSection ?? section;
}

/** The organization kind a sheet row's goal suggests (set only when the organization has none). */
function organizationKindFor(kind: OpportunityKind): OrganizationKind {
  switch (kind) {
    case "press":
    case "broadcast":
      return "press";
    case "fundraising":
    case "sponsorship":
    case "grant":
      return "funder";
    case "partnership":
    case "coproduction":
      return "partner";
    default:
      return "venue";
  }
}

/**
 * Add a venue / presenter: its organization (found by name or created, city
 * and website filled when empty), its contact and the goal (opportunity, kind
 * "booking" unless given) for the sheet. A contact is created when an email,
 * a name, a phone or a WhatsApp number is given: found by email when there is
 * one, otherwise by name (or phone) within the organization; empty fields of
 * an existing contact are filled. Phones are normalized with the sheet's
 * phone prefix.
 */
export async function addSheetRow(input: NewSheetRow): Promise<string> {
  const [sheet] = await sql<{ id: string; currency: string; phonePrefix: string | null }[]>`
    select id, currency, phone_prefix from projects where id = ${input.projectId} and sheet`;
  if (!sheet) throw new Error("Booking sheet not found");
  const orgName = input.organization.replace(/\s+/g, " ").trim();
  if (!orgName) throw new Error("Name the venue or presenter.");
  const kind: OpportunityKind = input.kind ?? "booking";
  checkGoalValues({ kind, nextAction: input.nextAction });

  const email = input.email?.trim() ? normalizeEmail(input.email) : null;
  if (email && !isValidEmail(email)) throw new Error(`Invalid email: ${input.email}`);
  const phone = cleanPhone(input.phone, sheet.phonePrefix);
  const whatsapp = cleanPhone(input.whatsapp, sheet.phonePrefix);
  const value = feeValue(input.fee);
  const name = oneLine(input.contactName);
  const role = oneLine(input.role);

  const organizationId = await findOrCreateOrganization(orgName);
  await sql`
    update organizations
       set city = coalesce(city, ${oneLine(input.city)}),
           website = coalesce(website, ${oneLine(input.website, 500)}),
           kind = case when kind is null or kind = 'other' then ${organizationKindFor(kind)} else kind end
     where id = ${organizationId}
  `;

  let contactId: string | null = null;
  if (email || name || phone || whatsapp) {
    let existingId: string | null = null;
    if (email) {
      existingId = (await getContactByEmail(email))?.id ?? null;
    } else if (name) {
      const [found] = await sql<{ id: string }[]>`
        select id from contacts
         where organization_id = ${organizationId} and lower(btrim(name)) = lower(${name})
         order by created_at limit 1`;
      existingId = found?.id ?? null;
    } else {
      const [found] = await sql<{ id: string }[]>`
        select id from contacts
         where organization_id = ${organizationId}
           and (phone = any(${[phone, whatsapp].filter(Boolean)}::text[]) or whatsapp = any(${[phone, whatsapp].filter(Boolean)}::text[]))
         order by created_at limit 1`;
      existingId = found?.id ?? null;
    }
    if (existingId) {
      contactId = existingId;
      await sql`
        update contacts
           set organization_id = coalesce(organization_id, ${organizationId}),
               role = coalesce(role, ${role}),
               name = coalesce(nullif(btrim(name), ''), ${name}),
               phone = coalesce(phone, ${phone}),
               whatsapp = coalesce(whatsapp, ${whatsapp}),
               status = case when status = 'new' then 'lead' else status end
         where id = ${existingId}
      `;
    } else {
      contactId = await createContact({
        name,
        emails: email ? [email] : [],
        organizationId,
        role,
        phone,
        whatsapp,
        status: "lead",
        projectIds: [sheet.id],
      });
    }
    await sql`insert into contact_projects (contact_id, project_id) values (${contactId}, ${sheet.id}) on conflict do nothing`;
  }

  const id = await createOpportunity({
    title: orgName,
    kind,
    stage: input.stage ?? "lead",
    contactId,
    organizationId,
    projectId: sheet.id,
    value,
    currency: sheet.currency,
    followUpAt: input.followUpAt || null,
    nextAction: input.nextAction ?? null,
    nextStep: oneLine(input.nextStep),
    notes: input.notes?.trim() || null,
  });
  await sql`
    update opportunities
       set event_dates = ${oneLine(input.eventDates)},
           sheet_section = ${await resolveSection(sql, sheet.id, input.section)},
           spaces = ${oneLine(input.spaces, 1000)},
           is_returning = ${Boolean(input.returning)}
     where id = ${id}
  `;
  return id;
}

export interface SheetRowPatch {
  stage?: OpportunityStage;
  /** The row's goal kind. */
  kind?: OpportunityKind;
  followUpAt?: string | null;
  /** null clears. */
  nextAction?: NextAction | null;
  nextStep?: string | null;
  eventDates?: string | null;
  /** As typed ("4.500"); null clears. */
  fee?: string | null;
  notes?: string | null;
  section?: string | null;
  spaces?: string | null;
  returning?: boolean;
  /** Written to the row's contact (created, unnamed, when the row has none). Normalized with the sheet's prefix. */
  phone?: string | null;
  whatsapp?: string | null;
}

/**
 * Patch semantics, one transaction. A status change also logs a "status"
 * activity ("To contact → Contacted", named for the row's goal kind) and sets
 * / clears closed_at.
 */
export async function updateSheetRow(id: string, patch: SheetRowPatch): Promise<void> {
  if (!ID.test(id)) throw new Error("Row not found");
  checkGoalValues(patch);
  await sql.begin(async (tx) => {
    const [row] = await tx<
      {
        stage: OpportunityStage;
        kind: OpportunityKind;
        contactId: string | null;
        organizationId: string | null;
        projectId: string | null;
        phonePrefix: string | null;
      }[]
    >`
      select op.stage, op.kind, op.contact_id, op.organization_id, op.project_id, p.phone_prefix
        from opportunities op
        join projects p on p.id = op.project_id and p.sheet
       where op.id = ${id}
         for update of op
    `;
    if (!row) throw new Error("Row not found");

    const values: Record<string, unknown> = {};
    const stageChanged = patch.stage !== undefined && patch.stage !== row.stage;
    const kind = patch.kind ?? row.kind;
    if (stageChanged) values.stage = patch.stage;
    if (patch.kind !== undefined && patch.kind !== row.kind) values.kind = patch.kind;
    if ("followUpAt" in patch) values.followUpAt = patch.followUpAt || null;
    if ("nextAction" in patch) values.nextAction = patch.nextAction || null;
    if ("nextStep" in patch) values.nextStep = oneLine(patch.nextStep);
    if ("eventDates" in patch) values.eventDates = oneLine(patch.eventDates);
    if ("fee" in patch) values.value = feeValue(patch.fee);
    if ("notes" in patch) values.notes = patch.notes?.trim() || null;
    if ("section" in patch) values.sheetSection = row.projectId ? await resolveSection(tx, row.projectId, patch.section) : oneLine(patch.section, 120);
    if ("spaces" in patch) values.spaces = oneLine(patch.spaces, 1000);
    if (patch.returning !== undefined) values.isReturning = Boolean(patch.returning);

    if (Object.keys(values).length) await tx`update opportunities set ${tx(values as never)} where id = ${id}`;
    if (stageChanged) {
      await tx`
        update opportunities
           set closed_at = case when stage in ('won', 'lost') then coalesce(closed_at, now()) else null end
         where id = ${id}`;
      await tx`
        insert into activities (kind, body, contact_id, organization_id, opportunity_id)
        values ('status', ${`${stageLabel(row.stage, kind)} → ${stageLabel(patch.stage!, kind)}`},
                ${row.contactId}, ${row.organizationId}, ${id})`;
    }

    if ("phone" in patch || "whatsapp" in patch) {
      const phones: Record<string, unknown> = {};
      if ("phone" in patch) phones.phone = cleanPhone(patch.phone, row.phonePrefix);
      if ("whatsapp" in patch) phones.whatsapp = cleanPhone(patch.whatsapp, row.phonePrefix);
      if (row.contactId) {
        await tx`update contacts set ${tx(phones as never)} where id = ${row.contactId}`;
      } else if (phones.phone || phones.whatsapp) {
        const [contact] = await tx<{ id: string }[]>`
          insert into contacts ${tx({ ...phones, organizationId: row.organizationId, status: "lead", source: "manual" } as never)}
          returning id`;
        if (row.projectId) await tx`insert into contact_projects (contact_id, project_id) values (${contact.id}, ${row.projectId}) on conflict do nothing`;
        await tx`update opportunities set contact_id = ${contact.id} where id = ${id}`;
      }
    }
  });
}

/**
 * Set the status, the section, the goal kind or the next step of several rows
 * of a sheet (status changes are logged per row). Returns how many rows were
 * found (and patched).
 */
export async function bulkUpdateSheetRows(
  projectId: string,
  rowIds: string[],
  patch: { stage?: OpportunityStage; section?: string | null; kind?: OpportunityKind; nextAction?: NextAction | null },
): Promise<number> {
  const ids = [...new Set(rowIds)].filter((id) => ID.test(id));
  if (!ids.length || !ID.test(projectId)) return 0;
  checkGoalValues(patch);
  const rows = await sql<{ id: string }[]>`
    select op.id from opportunities op
      join projects p on p.id = op.project_id and p.sheet
     where op.project_id = ${projectId} and op.id = any(${ids}::uuid[])`;
  for (const row of rows) {
    await updateSheetRow(row.id, {
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...("section" in patch ? { section: patch.section ?? null } : {}),
      ...("nextAction" in patch ? { nextAction: patch.nextAction ?? null } : {}),
    });
  }
  return rows.length;
}

/**
 * Move "To contact" rows to "Contacted" once you reached out after the row was
 * created: an email to the contact (synced from Gmail), or a call, WhatsApp,
 * meeting or logged email on the row or its contact. Logs a status entry
 * ("To contact → Contacted (email sent)"). Set-based and idempotent: call it
 * before showing a sheet (projectId) or the sheet list (no argument).
 * Returns how many rows moved.
 */
export async function advanceSheetStages(projectId?: string | null): Promise<number> {
  if (projectId && !ID.test(projectId)) return 0;
  // "To contact → Contacted" as each goal kind names it.
  const moveLabels = Object.fromEntries(GOAL_KINDS.map((k) => [k.value, `${stageLabel("lead", k.value)} → ${stageLabel("contacted", k.value)}`]));
  const rows = await sql<{ opportunityId: string }[]>`
    with candidates as (
      select op.id, op.kind, op.contact_id, op.organization_id,
             case when c.last_outbound_at > w.since
                   and (act.occurred_at is null or c.last_outbound_at <= act.occurred_at)
                  then 'email sent' else act.kind end as reason,
             case when c.last_outbound_at > w.since
                   and (act.occurred_at is null or c.last_outbound_at <= act.occurred_at)
                  then c.last_outbound_at else act.occurred_at end as at
        from opportunities op
        join projects p on p.id = op.project_id and p.sheet
        left join contacts c on c.id = op.contact_id
        -- Only what happened after the row was created or last changed status:
        -- a row put back to "To contact" by hand stays there.
        cross join lateral (
          select greatest(op.created_at, (select max(s.occurred_at) from activities s where s.opportunity_id = op.id and s.kind = 'status')) as since
        ) w
        left join lateral (
          select a.kind, a.occurred_at
            from activities a
           where (a.opportunity_id = op.id or (op.contact_id is not null and a.contact_id = op.contact_id))
             and a.kind in ('call', 'whatsapp', 'meeting', 'email')
             and a.occurred_at > w.since
           order by a.occurred_at
           limit 1
        ) act on true
       where op.stage = 'lead'
         ${projectId ? sql`and op.project_id = ${projectId}` : sql``}
         and (c.last_outbound_at > w.since or act.kind is not null)
    ),
    moved as (
      update opportunities op
         set stage = 'contacted'
        from candidates cand
       where op.id = cand.id and op.stage = 'lead'
      returning op.id, op.kind, op.contact_id, op.organization_id, cand.reason, cand.at
    )
    insert into activities (kind, body, occurred_at, opportunity_id, contact_id, organization_id)
    select 'status',
           coalesce(${sql.json(moveLabels)}::jsonb ->> kind, ${`${stageLabel("lead")} → ${stageLabel("contacted")}`})
             || ' (' || case reason when 'whatsapp' then 'WhatsApp' else reason end || ')',
           coalesce(at, now()), id, contact_id, organization_id
      from moved
    returning opportunity_id
  `;
  return rows.length;
}

/* Import ------------------------------------------------------------------- */

/**
 * Import pasted text / a CSV into a sheet: parseSheetImport, then addSheetRow
 * per row. A bad row never stops the others; a row whose venue and email (or
 * lack of one) already have a row in this sheet is skipped as a duplicate.
 */
export async function importSheetRows(projectId: string, text: string): Promise<ImportResult> {
  const [sheet] = await sql`select 1 from projects where id = ${projectId} and sheet`;
  if (!sheet) throw new Error("Booking sheet not found");
  const parsed = parseSheetImport(text);
  const errors = [...parsed.errors];
  let created = 0;
  let skipped = parsed.errors.filter((e) => e.line > 0).length;

  const existing = await sql<{ org: string; email: string | null }[]>`
    select lower(coalesce(o.name, op.title)) as org,
           (select ce.email from contact_emails ce where ce.contact_id = op.contact_id order by ce.is_primary desc, ce.created_at limit 1) as email
      from opportunities op
      left join organizations o on o.id = op.organization_id
     where op.project_id = ${projectId}
  `;
  const seen = new Set(existing.map((r) => `${r.org}\n${r.email ?? ""}`));

  for (const { line, ...row } of parsed.rows) {
    const key = `${row.organization.replace(/\s+/g, " ").trim().toLowerCase()}\n${row.email ? normalizeEmail(row.email) : ""}`;
    if (seen.has(key)) {
      errors.push({ line, message: `${row.organization}: already in this sheet.` });
      skipped++;
      continue;
    }
    try {
      await addSheetRow({ projectId, ...row });
      seen.add(key);
      created++;
    } catch (error) {
      errors.push({ line, message: `${row.organization}: ${errorMessage(error)}` });
      skipped++;
    }
  }
  return { created, skipped, errors: errors.sort((a, b) => a.line - b.line) };
}
