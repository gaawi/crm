import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";

/**
 * Everything VELA knows about one organization, for research
 * (GET /api/assistant-agent/organization?id=<uuid>): its fields, stored
 * profile, people (with their emails, photo and research state, and when we
 * last wrote / they last wrote) and campaign rows. The emails themselves come
 * from /history?organizationId=.
 */
export async function organizationDossier(id: string | null) {
  if (!id || !z.guid().safeParse(id).success) return null;
  const [org] = await sql<
    {
      id: string;
      name: string;
      kind: string | null;
      city: string | null;
      website: string | null;
      domains: string[];
      tags: string[];
      notes: string | null;
      profile: unknown;
    }[]
  >`select id, name, kind, city, website, domains, tags, notes, profile from organizations where id = ${id}`;
  if (!org) return null;
  const [people, rows] = await Promise.all([
    sql`
      select c.id, c.name, c.role, c.phone, c.notes, c.status, c.photo_url, c.photo_source, c.researched_at, c.research_sources,
             c.last_outbound_at, c.last_inbound_at,
             coalesce((select array_agg(ce.email order by ce.is_primary desc) from contact_emails ce where ce.contact_id = c.id), '{}') emails
        from contacts c
       where c.organization_id = ${id} and c.status <> 'archived'
       order by greatest(c.last_outbound_at, c.last_inbound_at) desc nulls last, c.name`,
    sql`
      select op.id, p.name project, op.sheet_section section, op.stage, op.title, op.notes, op.next_step, op.follow_up_at,
             (select coalesce(c.name, ce.email) from contacts c left join contact_emails ce on ce.contact_id = c.id and ce.is_primary where c.id = op.contact_id) contact
        from opportunities op left join projects p on p.id = op.project_id
       where op.organization_id = ${id}`,
  ]);
  return { organization: org, people, rows };
}
