import "server-only";
import { sql } from "@/lib/db";
import { OPEN_STAGES } from "@/lib/constants";
import type { Opportunity, OpportunityStage } from "@/lib/types";

export interface OpportunityFilters {
  stage?: OpportunityStage;
  projectId?: string;
  contactId?: string;
  organizationId?: string;
  /** Default false: won/lost excluded unless a stage filter asks for them. */
  includeClosed?: boolean;
}

export const opportunityColumns = () => sql`
  op.id, op.title, op.stage, op.value, op.currency, op.follow_up_at, op.next_step, op.notes,
  op.closed_at, op.created_at, op.updated_at,
  case when c.id is null then null else json_build_object(
    'id', c.id,
    'displayName', coalesce(
      nullif(btrim(c.name), ''),
      (select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1),
      'Unknown')
  ) end as contact,
  case when o.id is null then null else json_build_object('id', o.id, 'name', o.name) end as organization,
  case when p.id is null then null else json_build_object('id', p.id, 'name', p.name, 'color', p.color) end as project
`;

export const opportunityJoins = () => sql`
  left join contacts c on c.id = op.contact_id
  left join organizations o on o.id = op.organization_id
  left join projects p on p.id = op.project_id
`;

/** Ordered by follow_up_at (nulls last), then updated_at desc. */
export async function listOpportunities(filters: OpportunityFilters = {}): Promise<Opportunity[]> {
  return sql<Opportunity[]>`
    select ${opportunityColumns()}
      from opportunities op
      ${opportunityJoins()}
     where true
       ${filters.stage ? sql`and op.stage = ${filters.stage}` : filters.includeClosed ? sql`` : sql`and op.stage = any(${OPEN_STAGES}::text[])`}
       ${filters.projectId ? sql`and op.project_id = ${filters.projectId}` : sql``}
       ${filters.contactId ? sql`and op.contact_id = ${filters.contactId}` : sql``}
       ${filters.organizationId ? sql`and op.organization_id = ${filters.organizationId}` : sql``}
     order by op.follow_up_at asc nulls last, op.updated_at desc
  `;
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<Opportunity[]>`
    select ${opportunityColumns()} from opportunities op ${opportunityJoins()} where op.id = ${id}
  `;
  return row ?? null;
}

export interface OpportunityInput {
  title?: string;
  stage?: OpportunityStage;
  contactId?: string | null;
  organizationId?: string | null;
  projectId?: string | null;
  /** Decimal string or number; empty → null. */
  value?: string | number | null;
  currency?: string;
  followUpAt?: string | null;
  nextStep?: string | null;
  notes?: string | null;
}

/**
 * When a contact is given and organizationId is not, the contact's organization is used.
 * closed_at is set when the stage is won/lost.
 */
export async function createOpportunity(input: OpportunityInput & { title: string }): Promise<string> {
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Title is required");
  const stage = input.stage ?? "lead";
  let organizationId = input.organizationId ?? null;
  if (!organizationId && input.contactId) {
    const [contact] = await sql<{ organizationId: string | null }[]>`
      select organization_id from contacts where id = ${input.contactId}
    `;
    organizationId = contact?.organizationId ?? null;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into opportunities ${sql({
      title,
      stage,
      contactId: input.contactId || null,
      organizationId,
      projectId: input.projectId || null,
      value: parseMoney(input.value),
      currency: normalizeCurrency(input.currency),
      followUpAt: input.followUpAt || null,
      nextStep: input.nextStep?.trim() || null,
      notes: input.notes?.trim() || null,
    })}
    returning id
  `;
  if (!OPEN_STAGES.includes(stage)) await sql`update opportunities set closed_at = now() where id = ${row.id}`;
  return row.id;
}

/** Patch semantics. Moving to won/lost sets closed_at; moving back to an open stage clears it. */
export async function updateOpportunity(id: string, patch: OpportunityInput): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.replace(/\s+/g, " ").trim();
    if (!title) throw new Error("Title is required");
    values.title = title;
  }
  if (patch.stage !== undefined) values.stage = patch.stage;
  if ("contactId" in patch) values.contactId = patch.contactId || null;
  if ("organizationId" in patch) values.organizationId = patch.organizationId || null;
  if ("projectId" in patch) values.projectId = patch.projectId || null;
  if ("value" in patch) values.value = parseMoney(patch.value);
  if (patch.currency !== undefined) values.currency = normalizeCurrency(patch.currency);
  if ("followUpAt" in patch) values.followUpAt = patch.followUpAt || null;
  if ("nextStep" in patch) values.nextStep = patch.nextStep?.trim() || null;
  if ("notes" in patch) values.notes = patch.notes?.trim() || null;
  if (!Object.keys(values).length) return;

  await sql.begin(async (tx) => {
    const result = await tx`update opportunities set ${tx(values as never)} where id = ${id}`;
    if (result.count === 0) throw new Error("Opportunity not found");
    if (patch.stage !== undefined) {
      await tx`
        update opportunities
           set closed_at = case when stage in ('won', 'lost') then coalesce(closed_at, now()) else null end
         where id = ${id}
      `;
    }
  });
}

export async function deleteOpportunity(id: string): Promise<void> {
  await sql`delete from opportunities where id = ${id}`;
}

/* ------------------------------------------------------------------------- */

export function parseMoney(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(2) : null;
  const cleaned = value.replace(/[\s,$€£]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Invalid amount: ${value}`);
  return Number(cleaned).toFixed(2);
}

function normalizeCurrency(value: string | undefined): string {
  const code = (value ?? "USD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "USD";
}
