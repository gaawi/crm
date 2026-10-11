import "server-only";
import { sql } from "@/lib/db";
import { instrumentsMatching, parseInstruments, type RosterStatus } from "@/lib/musicians/instruments";
import type { ContactSummary } from "@/lib/types";
import { clampLimit, contactSummaryColumns, contactSummaryJoins, likePattern } from "./shared";

/**
 * Musicians roster: musician_profiles (one per musician contact) and
 * musician_gigs (what they played with us).
 *
 * The rating is private: it is only read when the caller passes
 * `withRating: true` (the app, when the owner asks to see it) and never by
 * Claude's tools.
 */

export interface MusicianProfile {
  contactId: string;
  instruments: string[];
  basedIn: string | null;
  website: string | null;
  roster: RosterStatus;
  notes: string | null;
  /** Only with `withRating: true`. */
  rating?: number | null;
  ratingNote?: string | null;
  updatedAt: Date;
}

export interface MusicianGig {
  id: string;
  contactId: string;
  title: string;
  playedOn: string | null;
  project: { id: string; name: string; color: string } | null;
  instrument: string | null;
  notes: string | null;
}

export interface MusicianRow extends Omit<MusicianProfile, "contactId"> {
  contact: ContactSummary;
  gigCount: number;
  lastGig: { title: string; playedOn: string | null } | null;
}

export interface MusicianInput {
  instruments?: string[] | string;
  basedIn?: string | null;
  website?: string | null;
  roster?: RosterStatus;
  notes?: string | null;
  rating?: number | null;
  ratingNote?: string | null;
}

const profileColumns = (withRating: boolean) => sql`
  mp.instruments, mp.based_in, mp.website, mp.roster, mp.notes, mp.updated_at
  ${withRating ? sql`, mp.rating, mp.rating_note` : sql``}
`;

export async function getMusicianProfile(contactId: string, opts: { withRating?: boolean } = {}): Promise<MusicianProfile | null> {
  const [row] = await sql<MusicianProfile[]>`
    select mp.contact_id, ${profileColumns(Boolean(opts.withRating))}
      from musician_profiles mp
     where mp.contact_id = ${contactId}
  `;
  return row ?? null;
}

/** Creates the profile (marks the contact as a musician) or updates the given fields. */
export async function saveMusicianProfile(contactId: string, input: MusicianInput): Promise<void> {
  const instruments = input.instruments === undefined ? undefined : parseInstruments(input.instruments);
  const has = (k: keyof MusicianInput) => input[k] !== undefined;
  await sql`
    insert into musician_profiles (contact_id, instruments, based_in, website, roster, notes, rating, rating_note)
    values (
      ${contactId},
      ${instruments ?? []}::text[],
      ${input.basedIn ?? null},
      ${input.website ?? null},
      ${input.roster ?? "maybe"},
      ${input.notes ?? null},
      ${input.rating ?? null},
      ${input.ratingNote ?? null}
    )
    on conflict (contact_id) do update set
      instruments = ${instruments !== undefined ? sql`excluded.instruments` : sql`musician_profiles.instruments`},
      based_in    = ${has("basedIn") ? sql`excluded.based_in` : sql`musician_profiles.based_in`},
      website     = ${has("website") ? sql`excluded.website` : sql`musician_profiles.website`},
      roster      = ${has("roster") ? sql`excluded.roster` : sql`musician_profiles.roster`},
      notes       = ${has("notes") ? sql`excluded.notes` : sql`musician_profiles.notes`},
      rating      = ${has("rating") ? sql`excluded.rating` : sql`musician_profiles.rating`},
      rating_note = ${has("ratingNote") ? sql`excluded.rating_note` : sql`musician_profiles.rating_note`}
  `;
}

/** No longer a musician: the profile goes, the gigs stay (history). */
export async function removeMusicianProfile(contactId: string): Promise<void> {
  await sql`delete from musician_profiles where contact_id = ${contactId}`;
}

export async function listGigs(contactId: string): Promise<MusicianGig[]> {
  return sql<MusicianGig[]>`
    select g.id, g.contact_id, g.title, g.played_on::text as played_on, g.instrument, g.notes,
           case when pr.id is null then null else json_build_object('id', pr.id, 'name', pr.name, 'color', pr.color) end as project
      from musician_gigs g
      left join projects pr on pr.id = g.project_id
     where g.contact_id = ${contactId}
     order by g.played_on desc nulls last, g.created_at desc
  `;
}

export async function addGig(
  contactId: string,
  gig: { title: string; playedOn?: string | null; projectId?: string | null; instrument?: string | null; notes?: string | null },
): Promise<string> {
  const instrument = gig.instrument ? (parseInstruments(gig.instrument)[0] ?? null) : null;
  const [row] = await sql<{ id: string }[]>`
    insert into musician_gigs (contact_id, title, played_on, project_id, instrument, notes)
    values (${contactId}, ${gig.title.trim()}, ${gig.playedOn || null}, ${gig.projectId || null}, ${instrument}, ${gig.notes || null})
    returning id
  `;
  return row.id;
}

export async function deleteGig(contactId: string, gigId: string): Promise<void> {
  await sql`delete from musician_gigs where id = ${gigId} and contact_id = ${contactId}`;
}

export interface MusicianFilters {
  /** Name, instrument in any language ("cellista", "voz"), city, notes. */
  q?: string;
  /** Exact instrument key. */
  instrument?: string;
  /** Any of these instrument keys (a family: every string instrument…). */
  instrumentsAny?: string[];
  roster?: RosterStatus;
  playedWithUs?: boolean;
  withRating?: boolean;
  limit?: number;
}

/** Instruments in use with how many musicians play each, most common first. */
export async function instrumentCounts(): Promise<{ instrument: string; count: number }[]> {
  return sql<{ instrument: string; count: number }[]>`
    select i as instrument, count(*)::int as count
      from musician_profiles mp
      join contacts c on c.id = mp.contact_id and c.status <> 'archived'
      cross join lateral unnest(mp.instruments) i
     group by i
     order by count(*) desc, i
  `;
}

export async function listMusicians(filters: MusicianFilters = {}): Promise<MusicianRow[]> {
  const q = filters.q?.trim() ?? "";
  const known = q ? (await instrumentCounts()).map((r) => r.instrument) : [];
  const keys = q ? instrumentsMatching(q, known) : [];
  const pattern = q ? likePattern(q) : null;
  const limit = clampLimit(filters.limit, 300, 1000);
  const rows = await sql<(Omit<MusicianRow, "contact"> & ContactSummary & { gigCount: number })[]>`
    select ${contactSummaryColumns()},
           ${profileColumns(Boolean(filters.withRating))},
           coalesce(g.count, 0)::int as gig_count,
           g.last as last_gig
      from musician_profiles mp
      join contacts c on c.id = mp.contact_id
      ${contactSummaryJoins()}
      left join lateral (
        select count(*) as count,
               (array_agg(json_build_object('title', x.title, 'playedOn', x.played_on::text)
                          order by x.played_on desc nulls last, x.created_at desc))[1] as last
          from musician_gigs x
         where x.contact_id = c.id
      ) g on true
     where c.status <> 'archived'
       ${filters.instrument ? sql`and ${filters.instrument} = any(mp.instruments)` : sql``}
       ${filters.instrumentsAny ? sql`and mp.instruments && ${filters.instrumentsAny}::text[]` : sql``}
       ${filters.roster ? sql`and mp.roster = ${filters.roster}` : sql``}
       ${filters.playedWithUs === true ? sql`and coalesce(g.count, 0) > 0` : filters.playedWithUs === false ? sql`and coalesce(g.count, 0) = 0` : sql``}
       ${
         pattern
           ? sql`and (
               mp.instruments && ${keys}::text[]
               or c.name ilike ${pattern}
               or c.role ilike ${pattern}
               or o.name ilike ${pattern}
               or mp.based_in ilike ${pattern}
               or mp.notes ilike ${pattern}
               or exists (select 1 from contact_emails ce2 where ce2.contact_id = c.id and ce2.email ilike ${pattern})
             )`
           : sql``
       }
     order by case mp.roster when 'roster' then 0 when 'maybe' then 1 else 2 end,
              coalesce(g.count, 0) > 0 desc,
              lower(coalesce(nullif(btrim(c.name), ''), e.emails[1], '')), c.id
     limit ${limit}
  `;
  return rows.map((r) => {
    const { instruments, basedIn, website, roster, notes, updatedAt, rating, ratingNote, gigCount, lastGig, ...contact } = r;
    const row: MusicianRow = { instruments, basedIn, website, roster, notes, updatedAt, gigCount, lastGig, contact: contact as ContactSummary };
    if (filters.withRating) {
      row.rating = rating ?? null;
      row.ratingNote = ratingNote ?? null;
    }
    return row;
  });
}
