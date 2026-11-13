-- Booking campaigns: sections by type of presenter, where a row came from in
-- its own column, and the row notes reduced to the research summary (the old
-- notes are kept in notes_history, never lost).

alter table opportunities add column if not exists origin text;
alter table opportunities add column if not exists notes_history text;

comment on column opportunities.origin is
  'Where the row came from (procedencia): josefina-2025, hubspot, musical-america, email, lists-2016-2019, research, other. ChatGPT: set it when adding a row; find the row in opportunities by project_id and organization_id.';
comment on column opportunities.notes_history is
  'Earlier notes of the row (origin lines, old replies, contact changes), moved out of notes on 2026-11-13 so notes only shows the research summary. Append, never overwrite.';
comment on column opportunities.sheet_section is
  'Booking USA sections by type: "Cámara · series y sociedades", "Cámara · festivales", "Presentadores generales", "Grandes producciones", "Fuera de perfil", "Por clasificar". crm_booking_type_section(profile, name, tags) suggests one from the research. Where the row came from goes in origin, not here.';

create or replace function crm_booking_type_section(p jsonb, p_name text, p_tags text[])
returns text language sql immutable as $$
  select case
    when p is null or not p ? 'booking' then 'Por clasificar'
    when p->'booking'->>'fit' = 'low' then 'Fuera de perfil'
    when 'chamber-specialist' = any(p_tags)
      then case when coalesce(p->>'kind', '') = 'festival' or p_name ~* 'festival' then 'Cámara · festivales' else 'Cámara · series y sociedades' end
    when (p->'booking'->'categories') ? 'staged-production-opera' or (p->'booking'->'categories') ? 'coproduction-potential'
      or coalesce(p->'booking'->>'type', '') ~* '(opera|theat|multidisciplin|museum|contemporary arts|art center)'
      or p_name ~* '(opera|theat|museum|kitchen|armory|skirball|mass moca|walker art|redcat|harlem stage|fisher center|national sawdust|roulette)'
      then 'Grandes producciones'
    else 'Presentadores generales'
  end
$$;
comment on function crm_booking_type_section(jsonb, text, text[]) is
  'Suggested Booking USA section from an organization''s research profile, name and tags.';
