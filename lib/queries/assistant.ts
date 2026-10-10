import "server-only";
import { sql } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import type { AssistantAction, AssistantActionStatus, AssistantSettings } from "@/lib/assistant/types";
import type { DraftStatus, EmailDraft } from "@/lib/types";
import { getDraft } from "@/lib/queries/drafts";

/**
 * The daily campaign assistant's rows: per-sheet settings (projects.assistant_*),
 * its recommended actions (assistant_actions) and its email proposals
 * (email_drafts with assistant_reason, linked to an 'email' action).
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Draft statuses that count as "already proposed" for a row (the routine never stacks a second one). */
export const OPEN_DRAFT_STATUSES: DraftStatus[] = ["proposed", "queued", "revising", "sending", "failed", "postponed", "changes_requested"];

/**
 * Postponed drafts and actions whose day has come go back to waiting for the
 * owner. Cheap and set-based: every screen that lists them (and the routine's
 * context) calls it first.
 */
export async function releasePostponed(today: string = todayIn(env.timezone)): Promise<void> {
  await sql`
    update email_drafts set status = 'proposed', postponed_until = null
     where status = 'postponed' and (postponed_until is null or postponed_until <= ${today}::date)`;
  await sql`
    update assistant_actions set status = 'open', postponed_until = null
     where status = 'postponed' and (postponed_until is null or postponed_until <= ${today}::date)`;
}

export async function getAssistantSettings(projectId: string): Promise<AssistantSettings | null> {
  if (!ID.test(projectId)) return null;
  const [row] = await sql<{ active: boolean; brief: string | null; lastRunAt: Date | null }[]>`
    select assistant_active as active, assistant_brief as brief, assistant_last_run_at as last_run_at
      from projects where id = ${projectId} and sheet`;
  return row ? { active: row.active, brief: row.brief, lastRunAt: row.lastRunAt ? new Date(row.lastRunAt).toISOString() : null } : null;
}

export async function updateAssistantSettings(projectId: string, patch: { active?: boolean; brief?: string | null }): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.active !== undefined) values.assistantActive = patch.active;
  if ("brief" in patch) values.assistantBrief = patch.brief?.trim() ? patch.brief.trim() : null;
  if (!Object.keys(values).length) return;
  const result = await sql`update projects set ${sql(values as never)} where id = ${projectId} and sheet`;
  if (!result.count) throw new Error("Booking sheet not found");
}

interface ActionRow extends Omit<AssistantAction, "createdAt" | "completedAt"> {
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Recommended actions. `activeOnly`: only sheets whose assistant is active;
 * `excludeDrafted`: leave out the ones whose email is listed as a draft.
 * Open first by priority, then newest.
 */
export async function listAssistantActions(
  options: { projectId?: string; statuses?: AssistantActionStatus[]; activeOnly?: boolean; excludeDrafted?: boolean; limit?: number } = {},
): Promise<AssistantAction[]> {
  if (options.projectId && !ID.test(options.projectId)) return [];
  const statuses = options.statuses ?? ["open"];
  const rows = await sql<ActionRow[]>`
    select aa.id, aa.project_id, p.name as project_name, aa.opportunity_id,
           coalesce(o.name, op.title) as row_name,
           case when c.id is null then null else json_build_object(
             'id', c.id,
             'displayName', coalesce(nullif(btrim(c.name), ''),
               (select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1), 'Unknown'),
             'phone', c.phone, 'whatsapp', c.whatsapp) end as contact,
           aa.kind, aa.title, aa.reason, aa.priority, aa.status, aa.postponed_until, aa.draft_id, aa.created_at, aa.completed_at
      from assistant_actions aa
      join projects p on p.id = aa.project_id
      left join opportunities op on op.id = aa.opportunity_id
      left join organizations o on o.id = op.organization_id
      left join contacts c on c.id = coalesce(aa.contact_id, op.contact_id)
     where aa.status = any(${statuses}::text[])
       ${options.projectId ? sql`and aa.project_id = ${options.projectId}` : sql``}
       ${options.activeOnly ? sql`and p.assistant_active and not p.archived` : sql``}
       ${options.excludeDrafted ? sql`and aa.draft_id is null` : sql``}
     order by ${statuses.includes("done") || statuses.includes("dismissed") ? sql`coalesce(aa.completed_at, aa.updated_at) desc` : sql`aa.priority, aa.created_at desc`}
     limit ${Math.min(Math.max(options.limit ?? 100, 1), 500)}
  `;
  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt).toISOString(),
    completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
  }));
}

/** An assistant email with its campaign (sheet) and priority. */
export interface AssistantDraft {
  draft: EmailDraft;
  projectId: string;
  projectName: string;
  priority: number;
}

/**
 * The assistant's emails in the given statuses (default: waiting for
 * approval), across sheets or for one. `activeOnly`: only active sheets.
 */
export async function listAssistantDrafts(
  options: { projectId?: string; statuses?: DraftStatus[]; activeOnly?: boolean; limit?: number } = {},
): Promise<AssistantDraft[]> {
  if (options.projectId && !ID.test(options.projectId)) return [];
  const statuses = options.statuses ?? ["proposed", "failed", "revising", "sending"];
  const rows = await sql<{ id: string; projectId: string; projectName: string; priority: number }[]>`
    select distinct on (d.id) d.id, aa.project_id, p.name as project_name, aa.priority, d.created_at
      from email_drafts d
      join assistant_actions aa on aa.draft_id = d.id
      join projects p on p.id = aa.project_id
     where d.status = any(${statuses}::text[])
       ${options.projectId ? sql`and aa.project_id = ${options.projectId}` : sql``}
       ${options.activeOnly ? sql`and p.assistant_active and not p.archived` : sql``}
     order by d.id
  `;
  rows.sort((a, b) => a.priority - b.priority);
  const limited = rows.slice(0, Math.min(Math.max(options.limit ?? 100, 1), 500));
  const drafts = await Promise.all(limited.map((r) => getDraft(r.id)));
  const out: AssistantDraft[] = [];
  limited.forEach((r, i) => {
    const draft = drafts[i];
    if (draft) out.push({ draft, projectId: r.projectId, projectName: r.projectName, priority: r.priority });
  });
  return out;
}

/** Owner: Done / Postpone / Dismiss on a recommended action (or reopen one). */
export async function setActionStatus(id: string, status: AssistantActionStatus, postponedUntil?: string | null): Promise<boolean> {
  if (!ID.test(id)) return false;
  const result = await sql`
    update assistant_actions
       set status = ${status},
           postponed_until = ${status === "postponed" ? (postponedUntil ?? null) : null}::date,
           completed_at = ${status === "done" || status === "dismissed" ? sql`now()` : sql`null`}
     where id = ${id}`;
  return result.count === 1;
}

/** Keep the email action of a draft in step with what happened to the draft. */
export async function syncDraftAction(draftId: string, status: AssistantActionStatus, postponedUntil: string | null = null): Promise<void> {
  await sql`
    update assistant_actions
       set status = ${status},
           postponed_until = ${postponedUntil}::date,
           completed_at = ${status === "done" || status === "dismissed" ? sql`now()` : sql`null`}
     where draft_id = ${draftId}`;
}

/** Booking sheets (not archived) and how many have their assistant active. */
export async function countAssistantSheets(): Promise<{ active: number; total: number }> {
  const [row] = await sql<{ active: number; total: number }[]>`
    select count(*) filter (where assistant_active)::int as active, count(*)::int as total from projects where sheet and not archived`;
  return row;
}
