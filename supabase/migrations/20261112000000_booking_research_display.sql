-- Public booking research saved straight to the database (by Claude through
-- crm_save_booking_research, or by ChatGPT) stores its facts under
-- profile.booking with research keys (fit_reason, program as a list,
-- programming_lead, venues, blockers...) and no profile.summary. The app only
-- shows a profile that has a summary, so those organizations looked empty.
--
-- crm_booking_research_display() adds the fields the app reads (summary,
-- tagline, kind, programming, venues, logo, images, booking.fitReasons,
-- booking.pitchTo, booking.pending...) from those facts, keeping every
-- original key (the program list moves to booking.evidence). A trigger runs
-- it whenever such a profile is written, and also tags the organization with
-- who researched it: research-claude or research-chatgpt.

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
    'images', images));

  return p || added || jsonb_build_object('booking', new_booking);
end;
$$;

comment on function crm_booking_research_display(jsonb, text, text) is
  'Adds the fields the app shows (summary, tagline, kind, programming, venues, logo, images, booking.fitReasons/pitchTo/pending) to a profile holding raw public booking research. Keeps every original key; booking.program (a list) moves to booking.evidence.';

create or replace function organizations_profile_research()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  who text := lower(coalesce(new.profile->>'researchedBy', ''));
  tag text;
begin
  if new.profile ? 'booking' and not new.profile ? 'summary' then
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

create or replace trigger organizations_profile_research
  before insert or update of profile on organizations
  for each row execute function organizations_profile_research();

-- Existing rows: make hidden research visible and tag who researched it.
update organizations set profile = profile
 where profile ? 'researchedBy' or (profile ? 'booking' and not profile ? 'summary');

comment on column organizations.tags is
  'Free tags. research-claude / research-chatgpt are added automatically (trigger organizations_profile_research) from profile.researchedBy, so the owner can see who researched each organization. ChatGPT: do not add them by hand; set profile.researchedBy to "ChatGPT ..." instead.';

comment on column organizations.profile is
  'Organization profile shown on its page. The app needs profile.summary (one paragraph). Booking research goes in profile.booking (fit high/medium/low, fitReasons, pitchTo {name, role, why}, pending [..]); write profile.researchedBy ("ChatGPT ..." or "claude") and profile.researchedAt. If you save raw research without summary, the trigger organizations_profile_research builds summary, tagline, programming and venues from booking.fit_reason, booking.type, booking.program, booking.venues and booking.programming_lead.';
