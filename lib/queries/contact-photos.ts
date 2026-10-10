import "server-only";
import { sql } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils";

/**
 * Contact photos (contacts.photo_url / photo_source / photo_updated_at) and
 * the list of a campaign's people that Claude researches photos for. URLs are
 * validated by the callers (lib/contacts/photo.ts); the table re-checks https.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Set (url) or remove (null) a contact's photo. False when the contact does not exist. */
export async function setContactPhoto(contactId: string, url: string | null, source: string | null = null): Promise<boolean> {
  if (!ID.test(contactId)) return false;
  const result = await sql`
    update contacts
       set photo_url = ${url}, photo_source = ${url ? source : null}, photo_updated_at = now(), updated_at = now()
     where id = ${contactId}`;
  return result.count === 1;
}

export async function contactIdForEmail(email: string): Promise<string | null> {
  const [row] = await sql<{ contactId: string }[]>`select contact_id from contact_emails where email = ${normalizeEmail(email)}`;
  return row?.contactId ?? null;
}

export async function contactExists(contactId: string): Promise<boolean> {
  if (!ID.test(contactId)) return false;
  const [row] = await sql`select 1 from contacts where id = ${contactId}`;
  return Boolean(row);
}

export interface CampaignContact {
  id: string;
  name: string | null;
  displayName: string;
  role: string | null;
  /** Primary first. */
  emails: string[];
  organization: { id: string; name: string; website: string | null } | null;
  photoUrl: string | null;
  photoSource: string | null;
  /** The campaign's rows (goals) with this person. */
  opportunityIds: string[];
}

/**
 * The people of a campaign: contacts of its rows, plus contacts added to the
 * project directly. Null when the project does not exist.
 */
export async function listCampaignContacts(
  projectId: string,
  options: { missingPhotoOnly?: boolean } = {},
): Promise<{ project: { id: string; name: string; sheet: boolean }; contacts: CampaignContact[] } | null> {
  if (!ID.test(projectId)) return null;
  const [project] = await sql<{ id: string; name: string; sheet: boolean }[]>`select id, name, sheet from projects where id = ${projectId}`;
  if (!project) return null;
  const contacts = await sql<CampaignContact[]>`
    with members as (
      select op.contact_id as id from opportunities op where op.project_id = ${projectId} and op.contact_id is not null
      union
      select cp.contact_id from contact_projects cp where cp.project_id = ${projectId}
    )
    select c.id,
           nullif(btrim(c.name), '') as name,
           coalesce(nullif(btrim(c.name), ''), e.emails[1], 'Unknown') as display_name,
           c.role,
           coalesce(e.emails, '{}') as emails,
           case when o.id is null then null else json_build_object('id', o.id, 'name', o.name, 'website', o.website) end as organization,
           c.photo_url,
           c.photo_source,
           coalesce((select array_agg(op.id::text order by op.created_at) from opportunities op
                      where op.project_id = ${projectId} and op.contact_id = c.id), '{}') as opportunity_ids
      from members m
      join contacts c on c.id = m.id
      left join organizations o on o.id = c.organization_id
      left join lateral (
        select array_agg(ce.email order by ce.is_primary desc, ce.created_at, ce.email) as emails
          from contact_emails ce where ce.contact_id = c.id
      ) e on true
     where c.status <> 'archived'
       ${options.missingPhotoOnly ? sql`and c.photo_url is null` : sql``}
     order by lower(coalesce(o.name, '')), lower(coalesce(nullif(btrim(c.name), ''), e.emails[1], ''))`;
  return { project, contacts };
}

/** Contacts of a campaign (rows' contacts and project members), for Today's campaign filter. */
export async function campaignContactIds(projectId: string): Promise<Set<string>> {
  if (!ID.test(projectId)) return new Set();
  const rows = await sql<{ id: string }[]>`
    select op.contact_id as id from opportunities op where op.project_id = ${projectId} and op.contact_id is not null
    union
    select cp.contact_id from contact_projects cp where cp.project_id = ${projectId}`;
  return new Set(rows.map((r) => r.id));
}
