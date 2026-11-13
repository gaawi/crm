-- Booking sections in US English (the app's language).
update opportunities set sheet_section = case sheet_section
    when 'Cámara · series y sociedades' then 'Chamber · series & societies'
    when 'Cámara · festivales' then 'Chamber · festivals'
    when 'Presentadores generales' then 'General presenters'
    when 'Grandes producciones' then 'Large productions'
    when 'Fuera de perfil' then 'Out of profile'
    when 'Por clasificar' then 'To classify'
    else sheet_section end
 where sheet_section in ('Cámara · series y sociedades', 'Cámara · festivales', 'Presentadores generales', 'Grandes producciones', 'Fuera de perfil', 'Por clasificar');

create or replace function crm_booking_type_section(p jsonb, p_name text, p_tags text[])
returns text language sql immutable as $$
  select case
    when p is null or not p ? 'booking' then 'To classify'
    when p->'booking'->>'fit' = 'low' then 'Out of profile'
    when 'chamber-specialist' = any(p_tags)
      then case when coalesce(p->>'kind', '') = 'festival' or p_name ~* 'festival' then 'Chamber · festivals' else 'Chamber · series & societies' end
    when (p->'booking'->'categories') ? 'staged-production-opera' or (p->'booking'->'categories') ? 'coproduction-potential'
      or coalesce(p->'booking'->>'type', '') ~* '(opera|theat|multidisciplin|museum|contemporary arts|art center)'
      or p_name ~* '(opera|theat|museum|kitchen|armory|skirball|mass moca|walker art|redcat|harlem stage|fisher center|national sawdust|roulette)'
      then 'Large productions'
    else 'General presenters'
  end
$$;

comment on column opportunities.sheet_section is
  'Booking USA sections by type: "Chamber · series & societies", "Chamber · festivals", "General presenters", "Large productions" (opera, theater, multidisciplinary), "Out of profile" (other genres, rentals, closed), "To classify". crm_booking_type_section(profile, name, tags) suggests one from the research. Where the row came from goes in origin, not here.';
