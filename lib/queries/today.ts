import "server-only";
import { sql } from "@/lib/db";

/** Campaigns (projects flagged sheet) for Today's filter: not archived, in the projects' order. */
export interface CampaignRef {
  id: string;
  name: string;
  color: string;
}

export async function listCampaignRefs(): Promise<CampaignRef[]> {
  return sql<CampaignRef[]>`select id, name, color from projects where sheet and not archived order by sort_order, lower(name)`;
}

/**
 * The campaigns each of the given contacts belongs to: as a row's contact
 * (opportunities.project_id) or as a member of the project (contact_projects).
 */
export async function contactCampaigns(contactIds: string[]): Promise<Map<string, Set<string>>> {
  const ids = [...new Set(contactIds)];
  const out = new Map<string, Set<string>>();
  if (!ids.length) return out;
  const rows = await sql<{ contactId: string; projectId: string }[]>`
    select op.contact_id, op.project_id
      from opportunities op join projects p on p.id = op.project_id
     where p.sheet and op.contact_id = any(${ids}::uuid[])
    union
    select cp.contact_id, cp.project_id
      from contact_projects cp join projects p on p.id = cp.project_id
     where p.sheet and cp.contact_id = any(${ids}::uuid[])`;
  for (const r of rows) {
    const set = out.get(r.contactId) ?? new Set<string>();
    set.add(r.projectId);
    out.set(r.contactId, set);
  }
  return out;
}
