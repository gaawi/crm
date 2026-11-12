-- 1. "Who has played": profile.artists built from the booking research
--    events (group name in bold on the organization page).
-- 2. The display function now also runs on profiles that already have a
--    summary (research saved onto an existing profile) and never overwrites
--    keys the profile already has.
-- 3. Tag nyc-under-5h: organizations whose city is at most about 5 hours by
--    car from Midtown Manhattan (OSRM driving time without traffic, US Census
--    2023 gazetteer coordinates, computed 2026-11-12).

create or replace function crm_booking_artists(evidence jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_agg(a order by ord, n) from (
    select jsonb_strip_nulls(jsonb_build_object(
             'name', left(name, 200),
             'formation', nullif(left(btrim(regexp_replace(regexp_replace(concat_ws(' · ', nullif(rest, ''), kind_label), '\s*[()]\s*', ', ', 'g'), ',\s*,', ',', 'g'), ' ,'), 120), ''),
             'date', nullif(left(dt, 60), ''))) a, ord, n
    from (
      select n,
             btrim(substring(ev from '^([^(,:;]+)')) name,
             btrim(regexp_replace(substring(ev from length(substring(ev from '^([^(,:;]+)')) + 1), '^[\s(,:;]+|\)$', '', 'g')) rest,
             case k when 'chamber' then 'Chamber music' when 'recital' then 'Recital' when 'orchestral' then 'Orchestra'
                    when 'multidisciplinary' then 'Multidisciplinary' when 'staged/opera/music-theater' then 'Stage / opera' end kind_label,
             dt,
             case k when 'chamber' then 0 when 'recital' then 1 when 'orchestral' then 2 when 'multidisciplinary' then 3 else 4 end ord
      from (
        select n,
               case jsonb_typeof(e) when 'string' then e #>> '{}' else e->>'event' end ev,
               case jsonb_typeof(e) when 'string' then null else e->>'kind' end k,
               case jsonb_typeof(e) when 'string' then null else e->>'date' end dt
        from jsonb_array_elements(case when jsonb_typeof(evidence) = 'array' then evidence else '[]'::jsonb end) with ordinality x(e, n)
      ) s
      where coalesce(ev, '') <> ''
    ) z
    where coalesce(name, '') <> '' and length(name) <= 120
    order by ord, n
    limit 40
  ) y;
$$;

comment on function crm_booking_artists(jsonb) is
  'Turns booking research evidence (program events) into profile.artists [{name, formation, date}] for the "Who has played" section: group name before the first comma/parenthesis, chamber music and recitals first.';

create or replace function crm_booking_research_display(p jsonb, p_name text, p_city text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  b jsonb := coalesce(p->'booking', '{}'::jsonb);
  kind_text text := b->>'type';
  fit_reason text := coalesce(nullif(b->>'fit_reason', ''), nullif(b->>'fitReasons', ''));
  lead jsonb := b->'programming_lead';
  programming text;
  venues jsonb;
  images jsonb;
  pending jsonb;
  added jsonb;
  new_booking jsonb;
begin
  if jsonb_typeof(b->'program') = 'array' then
    select string_agg(
             case jsonb_typeof(e)
               when 'string' then e #>> '{}'
               else concat_ws(' ', e->>'date', e->>'event') || coalesce(' [' || (e->>'kind') || ']', '')
             end, E'\n')
      into programming
      from jsonb_array_elements(b->'program') e;
  elsif jsonb_typeof(b->'program') = 'string' then
    programming := b->>'program';
  end if;

  if jsonb_typeof(b->'venues') = 'array' then
    select jsonb_agg(v) into venues from (
      select jsonb_strip_nulls(jsonb_build_object(
               'name', left(x->>'name', 200),
               'capacity', case when coalesce(x->>'capacity', x->>'seats') ~ '^\d{1,7}$'
                                then coalesce(x->>'capacity', x->>'seats')::int end,
               'notes', nullif(left(concat_ws('; ',
                          'Capacity source: ' || (x->>'capacity_source'),
                          x->>'capacity_note'), 500), ''))) v
        from jsonb_array_elements(b->'venues') x
       where jsonb_typeof(x) = 'object' and coalesce(x->>'name', '') <> ''
       limit 20) z;
  end if;

  if jsonb_typeof(p->'media') = 'array' then
    select jsonb_agg(i) into images from (
      select jsonb_strip_nulls(jsonb_build_object(
               'url', m->>'url', 'caption', left(m->>'title', 300), 'source', m->>'source_page')) i
        from jsonb_array_elements(p->'media') m
       where m->>'type' = 'venue_photo' and m->>'url' like 'https://%'
       limit 8) z;
  end if;

  if jsonb_typeof(b->'blockers') = 'array' then
    select jsonb_agg(left(x #>> '{}', 300)) into pending from (
      select x from jsonb_array_elements(b->'blockers') x
       where jsonb_typeof(x) = 'string' and btrim(x #>> '{}') <> '' limit 12) z;
  end if;

  new_booking := (b - 'program')
    || jsonb_strip_nulls(jsonb_build_object(
         'brand', coalesce(b->>'brand', 'CreArtBox'),
         'fitReasons', left(fit_reason, 1500),
         'evidence', b->'program',
         'pitchTo', case when coalesce(lead->>'name', '') <> '' then jsonb_strip_nulls(jsonb_build_object(
                      'name', left(lead->>'name', 200),
                      'role', left(lead->>'title', 200),
                      'why', left('Programming lead per ' || (lead->>'source'), 400))) end,
         'pending', pending,
         'verifiedAt', case when p->>'researchedAt' ~ '^\d{4}-\d{2}-\d{2}' then left(p->>'researchedAt', 10) end));

  added := jsonb_strip_nulls(jsonb_build_object(
    'summary', left(coalesce(nullif(b->>'official_name', ''), p_name, 'Organization')
                    || coalesce(' (' || kind_text || ')', '') || '. '
                    || coalesce(fit_reason, nullif(b->>'distinction', ''), 'Public booking research; see sources.'), 1500),
    'tagline', nullif(left(concat_ws(' · ', kind_text, p_city), 120), ''),
    'kind', case
              when kind_text ilike '%festival%' then 'festival'
              when kind_text ilike '%series%' then 'series'
              when kind_text ilike '%venue%' or kind_text ilike '%rental%' then 'venue'
              when kind_text ilike '%presenter%' or kind_text ilike '%association%' or kind_text ilike '%university%' then 'presenter'
              when kind_text is not null then 'organization'
            end,
    'programming', left(programming, 2000),
    'venues', venues,
    'logo', (select m->>'url' from jsonb_array_elements(case when jsonb_typeof(p->'media') = 'array' then p->'media' else '[]'::jsonb end) m
              where m->>'type' = 'logo' and m->>'url' like 'https://%' limit 1),
    'images', images,
    'artists', crm_booking_artists(b->'program')));

  -- Never overwrite what the profile already has (a summary written by the app, its own artists...).
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into added from jsonb_each(added) where not p ? key;

  return p || added || jsonb_build_object('booking', new_booking);
end;
$$;


create or replace function organizations_profile_research()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  who text := lower(coalesce(new.profile->>'researchedBy', ''));
  tag text;
begin
  if new.profile ? 'booking'
     and (not new.profile ? 'summary' or jsonb_typeof(new.profile->'booking'->'program') = 'array') then
    new.profile := crm_booking_research_display(new.profile, new.name, new.city);
  end if;
  tag := case when who like '%chatgpt%' then 'research-chatgpt'
              when who like '%claude%' then 'research-claude' end;
  if tag is not null and not (tag = any(coalesce(new.tags, '{}'))) then
    new.tags := coalesce(new.tags, '{}') || tag;
  end if;
  return new;
end;
$$;

-- Existing research profiles: fill "Who has played".
update organizations
   set profile = profile || jsonb_build_object('artists', crm_booking_artists(profile->'booking'->'evidence'))
 where jsonb_typeof(profile->'booking'->'evidence') = 'array'
   and not profile ? 'artists'
   and crm_booking_artists(profile->'booking'->'evidence') is not null;

update organizations set tags = array_append(tags, 'nyc-under-5h')
 where not ('nyc-under-5h' = any(tags))
   and trim(city) in (
  'Albany, NY',
  'Allentown, PA',
  'Amherst, MA',
  'Annandale-on-Hudson, NY',
  'Annapolis, MD',
  'Arlington, MA',
  'Ashburnham, MA',
  'BRONX, NY',
  'BROOKLYN, NY',
  'Baltimore, MD',
  'Bay Shore, NY',
  'Bayside, NY',
  'Beacon, NY',
  'Becket, MA',
  'Bensalem, PA',
  'Bethel, NY',
  'Bethlehem, PA',
  'Binghamton, NY',
  'Bloomsburg, PA',
  'Blue Bell, PA',
  'Boston, MA',
  'Branchburg, NJ',
  'Brattleboro, VT',
  'Bridgeport, CT',
  'Bristol, PA',
  'Bronx, NY',
  'Brookline, MA',
  'Brooklyn, NY',
  'Brookville, NY',
  'Brookyln, NY',
  'Bryn Mawr, PA',
  'Cambridge, MA',
  'Cambridge, NY',
  'Cape May Court House, NJ',
  'Cape May, NJ',
  'Carmel Hamlet, NY',
  'Chamberburg, PA',
  'Chappaqua, NY',
  'Chatham Township, NJ',
  'Chatham, NY',
  'Clinton, CT',
  'Clinton, NY',
  'College Park, MD',
  'Columbia, MD',
  'Concord, MA',
  'Cooperstown, NY',
  'Cortlandt Manor, NY',
  'Cresskill, NJ',
  'Delaware Water Gap, PA',
  'Delhi, NY',
  'East Hampton, NY',
  'East Stroudsburg, PA',
  'Easton, MD',
  'Easton, PA',
  'Elmira, NY',
  'Essex, CT',
  'Fairfield, CT',
  'Florence, MA',
  'Flushing, NY',
  'Frederick, MD',
  'Gaithersburg, MD',
  'Galloway, NJ',
  'Garden City, NY',
  'Garrison, NY',
  'Germantown, MD',
  'Gettysburg, PA',
  'Glassboro, NJ',
  'Great Barrington, MA',
  'Greenwich, CT',
  'Groton, MA',
  'Hardwick, MA',
  'Harrisburg, PA',
  'Hartford, CT',
  'Harwood, MD',
  'Haverford, PA',
  'Hazleton, PA',
  'Hershey, PA',
  'Holmdel, NJ',
  'Hudson, NY',
  'Hunter, NY',
  'Huntington Station, NY',
  'Huntington, NY',
  'Ithaca, NY',
  'Jamaica Plain, MA',
  'Jamestown, RI',
  'Jeffersonville, NY',
  'Keene, NH',
  'Kingston, RI',
  'Kutztown, PA',
  'Lake George, NY',
  'Lake Luzerne, NY',
  'Lakeville, CT',
  'Lakewood, NJ',
  'Lancaster, PA',
  'Langhorne, PA',
  'Lansdale, PA',
  'Lawrenceville, NJ',
  'Lebanon, PA',
  'Lenox, MA',
  'Lewes, DE',
  'Lewisburg, PA',
  'Lincoln, MA',
  'Linthicum Heights, MD',
  'Litchfield, CT',
  'Long Island City, NY',
  'Long Island City, Queens, NY',
  'Lowell, MA',
  'Lynn, MA',
  'Madison, NJ',
  'Mahwah, NJ',
  'Mamaroneck, NY',
  'Manasquan, NJ',
  'Manchester, CT',
  'Mechanicsburg, PA',
  'Media, PA',
  'Methuen, MA',
  'Middletown, CT',
  'Milford, PA',
  'Millwood, NY',
  'Montclair, NJ',
  'Montgomery, NY',
  'Morristown, NJ',
  'Mountainhome, PA',
  'Narrowsburg, NY',
  'New Bedford, MA',
  'New Brunswick, NJ',
  'New Haven, CT',
  'New London, CT',
  'New Paltz, NY',
  'New York, NY',
  'Newark, DE',
  'Newark, NJ',
  'Newburgh, NY',
  'Newton, MA',
  'Norfolk, CT',
  'North Adams, MA',
  'North Andover, MA',
  'North Bethesda, MD',
  'Nyack, NY',
  'Ocean Grove, NJ',
  'Old Lyme, CT',
  'Old Saybrook, CT',
  'Oldwick, NJ',
  'Oneonta, NY',
  'Otego, NY',
  'Owings Mills, MD',
  'Patchogue, NY',
  'Pawling, NY',
  'Peekskill, NY',
  'Philadelphia, PA',
  'Phoenicia, NY',
  'Pine Plains, NY',
  'Pittsfield, MA',
  'Pleasantville, NY',
  'Plymouth, MA',
  'Port Washington, NY',
  'Pottstown, PA',
  'Poughkeepsie, NY',
  'Princeton, NJ',
  'Providence, RI',
  'Purchase, NY',
  'Putney, VT',
  'Queens, NY',
  'Rahway, NJ',
  'Reading, PA',
  'Red Bank, NJ',
  'Ridgewood, NJ',
  'Riverdale, MD',
  'Rockville, MD',
  'Rutherford, NJ',
  'STATEN ISLAND, NY',
  'Sandisfield, MA',
  'Saratoga Springs, NY',
  'Schenectady, NY',
  'Schroon Lake, NY',
  'Scranton, PA',
  'Seaford, DE',
  'Selinsgrove, PA',
  'Shelburne Falls, MA',
  'Shelter Island Heights, NY',
  'Shelter Island, NY',
  'Shippensburg, PA',
  'Smyrna, DE',
  'Somerville, MA',
  'South Orange, NJ',
  'Southampton, NY',
  'Southold, NY',
  'Springfield, MA',
  'Staatsburg, NY',
  'Stamford, CT',
  'Staten Island, NY',
  'Stony Brook, NY',
  'Storrs, CT',
  'Sullivan, NH',
  'Tarrytown, NY',
  'Timonium, MD',
  'Trenton, NJ',
  'Troy, NY',
  'UTICA, NY',
  'Union, NJ',
  'University Park, PA',
  'Utica, NY',
  'Valhalla, NY',
  'W Hartford, CT',
  'Wallingford, CT',
  'Washington, CT',
  'Washington, DC',
  'Wayne, NJ',
  'Wayne, PA',
  'Waynesboro, PA',
  'Wellesley, MA',
  'Wellsboro, PA',
  'West Point, NY',
  'West Windsor, NJ',
  'Westfield, NJ',
  'Westport, CT',
  'Wheatley Heights, NY',
  'White Mills, PA',
  'White Plains, NY',
  'Wilkes-Barre, PA',
  'Williamsport, PA',
  'Williamstown, MA',
  'Wilmington, DE',
  'Wollaston, MA',
  'Woodstock, NY',
  'Woonsocket, RI',
  'Worcester, MA',
  'York, PA');

comment on column organizations.tags is
  'Free tags. research-claude / research-chatgpt are added automatically (trigger organizations_profile_research) from profile.researchedBy, so the owner can see who researched each organization. ChatGPT: do not add them by hand; set profile.researchedBy to "ChatGPT ..." instead. nyc-under-5h: the city is at most about 5 hours by car from Midtown Manhattan (OSRM driving time without traffic, computed 2026-11-12); add it to a new US organization only after checking the drive time.';
