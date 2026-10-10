import "server-only";
import { sql } from "@/lib/db";
import { readProfile, type OrgProfile, type OrgWithProfile } from "@/lib/organizations/profile";
import { normalizeEmail } from "@/lib/utils";

/** organizations.profile reads and writes (shape: lib/organizations/profile.ts). */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredProfile {
  profile: OrgProfile | null;
  profileUpdatedAt: Date | null;
}

export async function getOrganizationProfile(id: string): Promise<StoredProfile | null> {
  if (!ID.test(id)) return null;
  const [row] = await sql<{ profile: unknown; profileUpdatedAt: Date | null }[]>`
    select profile, profile_updated_at from organizations where id = ${id}`;
  return row ? { profile: readProfile(row.profile), profileUpdatedAt: row.profileUpdatedAt } : null;
}

/** The organization (with a profile) a card is shown for, or null. */
export async function getOrganizationWithProfile(id: string | null | undefined): Promise<OrgWithProfile | null> {
  if (!id || !ID.test(id)) return null;
  const [row] = await sql<{ id: string; name: string; website: string | null; city: string | null; profile: unknown }[]>`
    select id, name, website, city, profile from organizations where id = ${id} and profile is not null`;
  const profile = readProfile(row?.profile);
  return row && profile ? { id: row.id, name: row.name, website: row.website, city: row.city, profile } : null;
}

/** Replace (or, with null, remove) an organization's profile. False when it does not exist. */
export async function setOrganizationProfile(id: string, profile: OrgProfile | null): Promise<boolean> {
  if (!ID.test(id)) return false;
  const result = await sql`
    update organizations
       set profile = ${profile ? sql.json(profile as never) : null},
           profile_updated_at = ${profile ? sql`now()` : sql`null`}
     where id = ${id}`;
  return result.count === 1;
}

export async function organizationIdForOpportunity(opportunityId: string): Promise<string | null> {
  if (!ID.test(opportunityId)) return null;
  const [row] = await sql<{ organizationId: string | null }[]>`
    select coalesce(op.organization_id, c.organization_id) as organization_id
      from opportunities op
      left join contacts c on c.id = op.contact_id
     where op.id = ${opportunityId}`;
  return row?.organizationId ?? null;
}

export async function organizationIdForEmail(email: string): Promise<string | null> {
  const [row] = await sql<{ organizationId: string | null }[]>`
    select c.organization_id
      from contact_emails ce
      join contacts c on c.id = ce.contact_id
     where ce.email = ${normalizeEmail(email)}`;
  return row?.organizationId ?? null;
}

export interface ProjectOrganization {
  id: string;
  name: string;
  city: string | null;
  website: string | null;
  domains: string[];
  /** The sheet's rows (goals) with this organization. */
  opportunityIds: string[];
  /** Addresses of the rows' contacts. */
  contactEmails: string[];
  profile: OrgProfile | null;
  profileUpdatedAt: string | null;
}

/** The organizations of a project's (booking sheet's) rows, by name. Null when the project does not exist. */
export async function listProjectOrganizations(
  projectId: string,
  options: { missingOnly?: boolean } = {},
): Promise<{ project: { id: string; name: string }; organizations: ProjectOrganization[] } | null> {
  if (!ID.test(projectId)) return null;
  const [project] = await sql<{ id: string; name: string }[]>`select id, name from projects where id = ${projectId}`;
  if (!project) return null;
  const rows = await sql<(Omit<ProjectOrganization, "profile" | "profileUpdatedAt"> & { profile: unknown; profileUpdatedAt: Date | null })[]>`
    select o.id, o.name, o.city, o.website, o.domains, o.profile, o.profile_updated_at,
           array_agg(distinct op.id::text) as opportunity_ids,
           coalesce(array_agg(distinct ce.email) filter (where ce.email is not null), '{}') as contact_emails
      from opportunities op
      join organizations o on o.id = op.organization_id
      left join contact_emails ce on ce.contact_id = op.contact_id
     where op.project_id = ${projectId}
       ${options.missingOnly ? sql`and o.profile is null` : sql``}
     group by o.id
     order by lower(o.name)`;
  return {
    project,
    organizations: rows.map((r) => ({
      ...r,
      profile: readProfile(r.profile),
      profileUpdatedAt: r.profileUpdatedAt ? r.profileUpdatedAt.toISOString() : null,
    })),
  };
}
