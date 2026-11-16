-- "In NYC" tag: venues in New York City itself (the five boroughs). They are
-- not touring dates: with them we look for co-productions or the use of the
-- hall, never a fee pitch. Kept automatically from organizations.city.

create or replace function crm_is_nyc(p_city text) returns boolean
language sql immutable as $$
  select coalesce(p_city, '') ~* '^\s*(new york|new york city|nyc|manhattan|brooklyn|bronx|the bronx|queens|staten island|long island city|flushing|astoria|jamaica|forest hills|harlem)\s*(,.*)?,\s*(ny|new york)\s*$'
$$;

create or replace function organizations_nyc_tag() returns trigger
language plpgsql as $$
begin
  if crm_is_nyc(new.city) then
    new.tags := array_remove(coalesce(new.tags, '{}'), 'nyc-under-5h');
    if not ('nyc' = any(new.tags)) then
      new.tags := array_append(new.tags, 'nyc');
    end if;
  else
    new.tags := array_remove(coalesce(new.tags, '{}'), 'nyc');
  end if;
  return new;
end;
$$;

create or replace trigger organizations_nyc_tag
  before insert or update of city, tags on organizations
  for each row execute function organizations_nyc_tag();

update organizations set tags = tags
 where crm_is_nyc(city) or 'nyc' = any(tags);

comment on column organizations.tags is
  'Free tags. research-claude / research-chatgpt: added automatically (trigger organizations_profile_research) from profile.researchedBy; ChatGPT: do not add them by hand, set profile.researchedBy instead. nyc: added and removed automatically (trigger organizations_nyc_tag) when city is in New York City ("New York, NY", "Brooklyn, NY", "Bronx, NY", "Queens, NY", "Staten Island, NY", "Long Island City, NY", "Flushing, NY"...); ChatGPT: do not add it by hand, write the city as "<City>, NY" instead. NYC venues get no booking or fee pitch (we look for co-productions or venue use), so never queue a booking email for them. nyc-under-5h: city at most about 5 hours by car from Midtown Manhattan (OSRM, no traffic, 2026-11-12), never on NYC organizations. chamber-specialist: presents mainly chamber music or recitals. prestigious: places the owner really wants to play; the owner adds or removes it by hand.';
