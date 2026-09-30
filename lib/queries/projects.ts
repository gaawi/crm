import "server-only";
import { sql } from "@/lib/db";
import { PROJECT_COLORS } from "@/lib/constants";
import type { Project } from "@/lib/types";

const projectColumns = () => sql`
  p.id, p.name, p.color, p.description, p.archived, p.sort_order,
  (select count(*)::int
     from contact_projects cp join contacts c on c.id = cp.contact_id
    where cp.project_id = p.id and c.status <> 'archived') as contact_count,
  (select count(*)::int
     from opportunities op
    where op.project_id = p.id and op.stage not in ('won', 'lost')) as open_opportunity_count
`;

/** Ordered by sort_order, name. Counts exclude archived contacts and closed opportunities. */
export async function listProjects(options: { includeArchived?: boolean } = {}): Promise<Project[]> {
  return sql<Project[]>`
    select ${projectColumns()}
      from projects p
     where ${options.includeArchived ? sql`true` : sql`not p.archived`}
     order by p.archived, p.sort_order, lower(p.name)
  `;
}

export async function getProject(id: string): Promise<Project | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<Project[]>`select ${projectColumns()} from projects p where p.id = ${id}`;
  return row ?? null;
}

/** Case-insensitive name match. */
export async function getProjectByName(name: string): Promise<Project | null> {
  const [row] = await sql<Project[]>`
    select ${projectColumns()} from projects p where lower(p.name) = lower(${name.trim()})
  `;
  return row ?? null;
}

export interface ProjectInput {
  name?: string;
  color?: string;
  description?: string | null;
  archived?: boolean;
  sortOrder?: number;
}

function validColor(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  return color in PROJECT_COLORS ? color : "gray";
}

export async function createProject(input: ProjectInput & { name: string }): Promise<string> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Project name is required");
  const existing = await getProjectByName(name);
  if (existing) throw new Error(`A project named "${existing.name}" already exists`);
  const [row] = await sql<{ id: string }[]>`
    insert into projects (name, color, description, sort_order)
    values (
      ${name},
      ${validColor(input.color) ?? "gray"},
      ${input.description?.trim() || null},
      coalesce(${input.sortOrder ?? null}::int, (select coalesce(max(sort_order), 0) + 1 from projects))
    )
    returning id
  `;
  return row.id;
}

export async function updateProject(id: string, patch: ProjectInput): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = patch.name.replace(/\s+/g, " ").trim();
    if (!name) throw new Error("Project name is required");
    values.name = name;
  }
  if (patch.color !== undefined) values.color = validColor(patch.color);
  if ("description" in patch) values.description = patch.description?.trim() || null;
  if (patch.archived !== undefined) values.archived = patch.archived;
  if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
  if (!Object.keys(values).length) return;
  await sql`update projects set ${sql(values as never)} where id = ${id}`;
}

export async function deleteProject(id: string): Promise<void> {
  await sql`delete from projects where id = ${id}`;
}
