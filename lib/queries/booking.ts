import "server-only";
import { sql } from "@/lib/db";
import { createContact, getContactByEmail } from "@/lib/queries/contacts";
import { createOpportunity, updateOpportunity } from "@/lib/queries/opportunities";
import { findOrCreateOrganization } from "@/lib/queries/organizations";
import { createProject } from "@/lib/queries/projects";
import type { OpportunityStage } from "@/lib/types";
import { isValidEmail, normalizeEmail } from "@/lib/utils";

/**
 * Booking sheets: projects flagged `sheet`, whose rows are booking deals
 * (opportunities of kind "booking") with their organization and contact.
 */

export interface BookingSheet {
  id: string;
  name: string;
  color: string;
  description: string | null;
  currency: string;
  rows: number;
  open: number;
  confirmed: number;
  declined: number;
  /** Open rows whose follow-up date is today or earlier. */
  followUpsDue: number;
}

export interface SheetRow {
  id: string;
  title: string;
  stage: OpportunityStage;
  value: string | null;
  currency: string;
  followUpAt: string | null;
  nextStep: string | null;
  notes: string | null;
  eventDates: string | null;
  updatedAt: Date;
  organization: { id: string; name: string; city: string | null; website: string | null } | null;
  contact: {
    id: string;
    displayName: string;
    role: string | null;
    email: string | null;
    lastContactedAt: Date | null;
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    awaitingReplySince: Date | null;
  } | null;
}

export async function listSheets(today: string): Promise<BookingSheet[]> {
  return sql<BookingSheet[]>`
    select p.id, p.name, p.color, p.description, p.currency,
           count(op.id)::int as rows,
           count(op.id) filter (where op.stage not in ('won', 'lost'))::int as open,
           count(op.id) filter (where op.stage = 'won')::int as confirmed,
           count(op.id) filter (where op.stage = 'lost')::int as declined,
           count(op.id) filter (where op.stage not in ('won', 'lost') and op.follow_up_at <= ${today}::date)::int as follow_ups_due
      from projects p
      left join opportunities op on op.project_id = p.id and op.kind = 'booking'
     where p.sheet and not p.archived
     group by p.id
     order by p.sort_order, p.name
  `;
}

export async function getSheet(id: string): Promise<BookingSheet | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<BookingSheet[]>`
    select p.id, p.name, p.color, p.description, p.currency,
           0 as rows, 0 as open, 0 as confirmed, 0 as declined, 0 as follow_ups_due
      from projects p where p.id = ${id} and p.sheet
  `;
  return row ?? null;
}

const STAGE_ORDER = ["negotiation", "proposal", "contacted", "lead", "won", "lost"];

/** Rows: open ones by how far along they are, then confirmed, then declined; follow-ups due first within a stage. */
export async function getSheetRows(projectId: string): Promise<SheetRow[]> {
  return sql<SheetRow[]>`
    select op.id, op.title, op.stage, op.value, op.currency, op.follow_up_at, op.next_step, op.notes, op.event_dates, op.updated_at,
           case when o.id is null then null else json_build_object('id', o.id, 'name', o.name, 'city', o.city, 'website', o.website) end as organization,
           case when c.id is null then null else json_build_object(
             'id', c.id,
             'displayName', coalesce(nullif(btrim(c.name), ''), e.email, 'Unknown'),
             'role', c.role,
             'email', e.email,
             'lastContactedAt', c.last_contacted_at,
             'lastInboundAt', c.last_inbound_at,
             'lastOutboundAt', c.last_outbound_at,
             'awaitingReplySince', c.awaiting_reply_since) end as contact
      from opportunities op
      left join organizations o on o.id = op.organization_id
      left join contacts c on c.id = op.contact_id
      left join lateral (
        select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1
      ) e on true
     where op.project_id = ${projectId} and op.kind = 'booking'
     order by array_position(${STAGE_ORDER}::text[], op.stage), op.follow_up_at asc nulls last, lower(coalesce(o.name, op.title))
  `;
}

export async function createSheet(input: { name: string; currency?: string; description?: string | null }): Promise<string> {
  const id = await createProject({ name: input.name, description: input.description ?? null });
  const currency = (input.currency ?? "USD").trim().toUpperCase();
  await sql`update projects set sheet = true, currency = ${/^[A-Z]{3}$/.test(currency) ? currency : "USD"} where id = ${id}`;
  return id;
}

export interface NewSheetRow {
  projectId: string;
  organization: string;
  city?: string | null;
  website?: string | null;
  contactName?: string | null;
  role?: string | null;
  email?: string | null;
  eventDates?: string | null;
  fee?: string | null;
  followUpAt?: string | null;
  nextStep?: string | null;
  notes?: string | null;
  stage?: OpportunityStage;
}

/**
 * Add a venue / presenter: its organization (found by name or created, city
 * and website filled when empty), its contact (found by email or created as a
 * lead in that organization and project) and the booking deal for the sheet.
 */
export async function addSheetRow(input: NewSheetRow): Promise<string> {
  const [sheet] = await sql<{ id: string; currency: string }[]>`select id, currency from projects where id = ${input.projectId} and sheet`;
  if (!sheet) throw new Error("Booking sheet not found");
  const orgName = input.organization.replace(/\s+/g, " ").trim();
  if (!orgName) throw new Error("Name the venue or presenter.");

  const organizationId = await findOrCreateOrganization(orgName);
  await sql`
    update organizations
       set city = coalesce(city, ${input.city?.trim() || null}),
           website = coalesce(website, ${input.website?.trim() || null}),
           kind = case when kind = 'other' then 'venue' else kind end
     where id = ${organizationId}
  `;

  let contactId: string | null = null;
  const email = input.email ? normalizeEmail(input.email) : null;
  if (email) {
    if (!isValidEmail(email)) throw new Error(`Invalid email: ${input.email}`);
    const existing = await getContactByEmail(email);
    if (existing) {
      contactId = existing.id;
      await sql`
        update contacts
           set organization_id = coalesce(organization_id, ${organizationId}),
               role = coalesce(role, ${input.role?.trim() || null}),
               name = coalesce(nullif(btrim(name), ''), ${input.contactName?.trim() || null})
         where id = ${existing.id}
      `;
    } else {
      contactId = await createContact({
        name: input.contactName?.trim() || null,
        emails: [email],
        organizationId,
        role: input.role?.trim() || null,
        status: "lead",
        projectIds: [sheet.id],
      });
    }
    await sql`insert into contact_projects (contact_id, project_id) values (${contactId}, ${sheet.id}) on conflict do nothing`;
  }

  const id = await createOpportunity({
    title: orgName,
    kind: "booking",
    stage: input.stage ?? "lead",
    contactId,
    organizationId,
    projectId: sheet.id,
    value: input.fee || null,
    currency: sheet.currency,
    followUpAt: input.followUpAt || null,
    nextStep: input.nextStep || null,
    notes: input.notes || null,
  });
  if (input.eventDates?.trim()) await sql`update opportunities set event_dates = ${input.eventDates.trim()} where id = ${id}`;
  return id;
}

export interface SheetRowPatch {
  stage?: OpportunityStage;
  followUpAt?: string | null;
  nextStep?: string | null;
  eventDates?: string | null;
  fee?: string | null;
  notes?: string | null;
}

export async function updateSheetRow(id: string, patch: SheetRowPatch): Promise<void> {
  const { eventDates, fee, ...rest } = patch;
  const opportunityPatch = { ...rest, ...(fee !== undefined ? { value: fee } : {}) };
  if (Object.keys(opportunityPatch).length) await updateOpportunity(id, opportunityPatch);
  if (eventDates !== undefined) {
    const result = await sql`update opportunities set event_dates = ${eventDates?.trim() || null} where id = ${id} and kind = 'booking'`;
    if (result.count === 0) throw new Error("Row not found");
  }
}
