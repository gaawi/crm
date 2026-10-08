import "server-only";
import { sql } from "@/lib/db";
import { TEMPLATE_TRIGGERS } from "@/lib/constants";
import { STARTER_TEMPLATES } from "@/lib/booking/starter-templates";
import type { EmailTemplate } from "@/lib/booking/types";
import type { TemplateTrigger } from "@/lib/types";

/**
 * Email templates of booking sheets: a sheet's own (project_id) and global
 * ones (project_id null, offered in every sheet).
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TEMPLATE_LIMITS = { name: 120, subject: 300, body: 20_000 } as const;

interface TemplateRow extends Omit<EmailTemplate, "createdAt" | "updatedAt"> {
  createdAt: Date;
  updatedAt: Date;
}

const columns = () => sql`t.id, t.project_id, t.name, t.trigger, t.subject, t.body, t.sort_order, t.created_at, t.updated_at`;

function toTemplate(row: TemplateRow): EmailTemplate {
  return { ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() };
}

/** The sheet's templates first, then global ones; each by sort order, then name. projectId null → global only. */
export async function listTemplates(projectId: string | null): Promise<EmailTemplate[]> {
  const rows = await sql<TemplateRow[]>`
    select ${columns()}
      from email_templates t
     where t.project_id is null ${projectId && ID.test(projectId) ? sql`or t.project_id = ${projectId}` : sql``}
     order by (t.project_id is null), t.sort_order, lower(t.name), t.created_at
  `;
  return rows.map(toTemplate);
}

export async function getTemplate(id: string): Promise<EmailTemplate | null> {
  if (!ID.test(id)) return null;
  const [row] = await sql<TemplateRow[]>`select ${columns()} from email_templates t where t.id = ${id}`;
  return row ? toTemplate(row) : null;
}

export interface TemplateInput {
  /** null = every sheet. */
  projectId?: string | null;
  name?: string;
  trigger?: TemplateTrigger;
  subject?: string;
  body?: string;
  sortOrder?: number;
}

function clean(input: TemplateInput): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.replace(/\s+/g, " ").trim();
    if (!name) throw new Error("Give the template a name.");
    if (name.length > TEMPLATE_LIMITS.name) throw new Error("The name is too long.");
    values.name = name;
  }
  if (input.trigger !== undefined) {
    if (!TEMPLATE_TRIGGERS.some((t) => t.value === input.trigger)) throw new Error("Unknown template type.");
    values.trigger = input.trigger;
  }
  if (input.subject !== undefined) {
    const subject = input.subject.replace(/\s+/g, " ").trim();
    if (subject.length > TEMPLATE_LIMITS.subject) throw new Error("The subject is too long.");
    values.subject = subject;
  }
  if (input.body !== undefined) {
    if (input.body.length > TEMPLATE_LIMITS.body) throw new Error("The text is too long.");
    values.body = input.body.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  }
  if (input.sortOrder !== undefined) values.sortOrder = Math.max(-1_000_000, Math.min(1_000_000, Math.round(input.sortOrder)));
  if ("projectId" in input) values.projectId = input.projectId || null;
  return values;
}

/** Returns the id. Without sortOrder the template goes last in its sheet. */
export async function createTemplate(
  input: TemplateInput & { name: string; trigger: TemplateTrigger; subject: string; body: string },
): Promise<string> {
  const values = clean({ ...input, projectId: input.projectId ?? null });
  const projectId = (values.projectId as string | null) ?? null;
  if (projectId) {
    const [project] = await sql`select 1 from projects where id = ${projectId}`;
    if (!project) throw new Error("Sheet not found");
  }
  const [row] = await sql<{ id: string }[]>`
    insert into email_templates (project_id, name, trigger, subject, body, sort_order)
    values (
      ${projectId}, ${values.name as string}, ${values.trigger as string}, ${values.subject as string}, ${values.body as string},
      coalesce(${(values.sortOrder as number | undefined) ?? null}::int,
               (select coalesce(max(sort_order), 0) + 1 from email_templates where project_id is not distinct from ${projectId}::uuid))
    )
    returning id
  `;
  return row.id;
}

/** Patch semantics. */
export async function updateTemplate(id: string, patch: TemplateInput): Promise<void> {
  if (!ID.test(id)) throw new Error("Template not found");
  const values = clean(patch);
  if (!Object.keys(values).length) return;
  const result = await sql`update email_templates set ${sql(values as never)} where id = ${id}`;
  if (result.count === 0) throw new Error("Template not found");
}

export async function deleteTemplate(id: string): Promise<void> {
  if (!ID.test(id)) return;
  await sql`delete from email_templates where id = ${id}`;
}

/**
 * Copy a sheet's own templates into another sheet (global ones are shared
 * already). Templates whose name the target already uses are skipped.
 * Returns how many were copied.
 */
export async function copyTemplates(fromProjectId: string, toProjectId: string): Promise<number> {
  if (!ID.test(fromProjectId) || !ID.test(toProjectId) || fromProjectId === toProjectId) return 0;
  const result = await sql`
    insert into email_templates (project_id, name, trigger, subject, body, sort_order)
    select ${toProjectId}, t.name, t.trigger, t.subject, t.body,
           (select coalesce(max(sort_order), 0) from email_templates where project_id = ${toProjectId})
             + row_number() over (order by t.sort_order, lower(t.name))
      from email_templates t
     where t.project_id = ${fromProjectId}
       and exists (select 1 from projects where id = ${toProjectId})
       and not exists (select 1 from email_templates x where x.project_id = ${toProjectId} and lower(x.name) = lower(t.name))
  `;
  return result.count;
}

/** Add the starter templates (one per situation, Spanish) to a sheet, skipping names it already uses. Returns how many were added. */
export async function addStarterTemplates(projectId: string): Promise<number> {
  if (!ID.test(projectId)) return 0;
  const [project] = await sql`select 1 from projects where id = ${projectId}`;
  if (!project) throw new Error("Sheet not found");
  const existing = new Set(
    (await sql<{ name: string }[]>`select lower(name) as name from email_templates where project_id = ${projectId}`).map((r) => r.name),
  );
  let added = 0;
  for (const template of STARTER_TEMPLATES) {
    if (existing.has(template.name.toLowerCase())) continue;
    await createTemplate({ ...template, projectId });
    added++;
  }
  return added;
}
