-- ============================================================================
-- Musicians roster.
--
-- Any contact can be marked as a musician: instruments, where they are based,
-- website, whether they are in our roster, the concerts they played with us,
-- and a private rating ("would we play with them again?").
--
--   musician_profiles  one row per musician contact (no row = not a musician)
--     instruments      canonical keys from lib/musicians/instruments.ts
--                      ('cello', 'violin', 'soprano'…) or free lower-case text
--     roster           'roster' (call them) | 'maybe' | 'not_now'
--     rating           1–5, PRIVATE — with rating_note it is shown only on
--                      request in the app and never given to Claude
--   musician_gigs      concerts / projects they played with us (date optional)
--
-- Merging two contacts keeps the musician data (merge_contacts below).
-- Idempotent: safe to run twice.
-- ============================================================================

create table if not exists musician_profiles (
  contact_id   uuid primary key references contacts (id) on delete cascade,
  instruments  text[] not null default '{}',
  based_in     text check (based_in is null or length(based_in) <= 200),
  website      text check (website is null or (website ~ '^https?://[^\s/]+[^\s]*$' and length(website) <= 2048)),
  roster       text not null default 'maybe' check (roster in ('roster', 'maybe', 'not_now')),
  notes        text check (notes is null or length(notes) <= 5000),
  rating       smallint check (rating between 1 and 5),
  rating_note  text check (rating_note is null or length(rating_note) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists musician_profiles_instruments_idx on musician_profiles using gin (instruments);
drop trigger if exists musician_profiles_updated_at on musician_profiles;
create trigger musician_profiles_updated_at before update on musician_profiles
  for each row execute function set_updated_at();

create table if not exists musician_gigs (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 300),
  played_on   date,
  project_id  uuid references projects (id) on delete set null,
  instrument  text check (instrument is null or length(instrument) <= 100),
  notes       text check (notes is null or length(notes) <= 2000),
  created_at  timestamptz not null default now()
);
create index if not exists musician_gigs_contact_idx on musician_gigs (contact_id, played_on desc nulls last);

-- ---------------------------------------------------------------------------
-- merge_contacts: same as before, plus the musician profile and gigs.
-- ---------------------------------------------------------------------------
create or replace function merge_contacts(p_target uuid, p_source uuid)
returns void
language plpgsql as $$
declare
  s contacts%rowtype;
  t contacts%rowtype;
begin
  if p_target = p_source then
    raise exception 'cannot merge a contact into itself';
  end if;

  -- Lock both rows in id order.
  perform 1 from contacts where id in (p_target, p_source) order by id for update;
  select * into t from contacts where id = p_target;
  if not found then
    raise exception 'target contact % not found', p_target;
  end if;
  select * into s from contacts where id = p_source;
  if not found then
    raise exception 'source contact % not found', p_source;
  end if;

  -- Keep the target's primary address; the source's primary becomes primary
  -- only if the target has none.
  update contact_emails
     set contact_id = p_target,
         is_primary = is_primary and not exists (
           select 1 from contact_emails x where x.contact_id = p_target and x.is_primary)
   where contact_id = p_source;

  insert into contact_projects (contact_id, project_id)
  select p_target, project_id from contact_projects where contact_id = p_source
  on conflict do nothing;

  update opportunities set contact_id = p_target where contact_id = p_source;
  update activities set contact_id = p_target where contact_id = p_source;
  update musician_gigs set contact_id = p_target where contact_id = p_source;

  -- Musician profile: the target's fields win, the source fills the gaps.
  if exists (select 1 from musician_profiles where contact_id = p_source) then
    if exists (select 1 from musician_profiles where contact_id = p_target) then
      update musician_profiles mt
         set instruments = array(select distinct x from unnest(mt.instruments || ms.instruments) as x order by x),
             based_in    = coalesce(mt.based_in, ms.based_in),
             website     = coalesce(mt.website, ms.website),
             notes       = case
                             when coalesce(btrim(ms.notes), '') = '' then mt.notes
                             when coalesce(btrim(mt.notes), '') = '' then ms.notes
                             else mt.notes || E'\n\n' || ms.notes
                           end,
             rating      = coalesce(mt.rating, ms.rating),
             rating_note = coalesce(mt.rating_note, ms.rating_note)
        from musician_profiles ms
       where mt.contact_id = p_target and ms.contact_id = p_source;
    else
      update musician_profiles set contact_id = p_target where contact_id = p_source;
    end if;
  end if;

  update contacts c
     set name            = coalesce(nullif(btrim(t.name), ''), s.name),
         organization_id = coalesce(t.organization_id, s.organization_id),
         role            = coalesce(nullif(btrim(t.role), ''), s.role),
         phone           = coalesce(t.phone, s.phone),
         whatsapp        = coalesce(t.whatsapp, s.whatsapp),
         notes           = case
                             when coalesce(btrim(s.notes), '') = '' then t.notes
                             when coalesce(btrim(t.notes), '') = '' then s.notes
                             else t.notes || E'\n\n' || s.notes
                           end,
         tags            = array(select distinct x from unnest(t.tags || s.tags) as x order by x),
         -- The earliest follow-up wins, with its own note.
         (follow_up_at, follow_up_note) = (
           select d, n from (values (t.follow_up_at, t.follow_up_note), (s.follow_up_at, s.follow_up_note)) v(d, n)
            order by d nulls last limit 1),
         status          = case
                             when t.status = 'new' and s.status <> 'archived' then s.status
                             else t.status
                           end,
         source          = case
                             when t.source = 'manual' or s.source = 'manual' then 'manual'
                             else 'gmail'
                           end,
         reply_dismissed_at = greatest(t.reply_dismissed_at, s.reply_dismissed_at)
   where c.id = p_target;

  delete from contacts where id = p_source;

  perform refresh_contact_stats(array[p_target]);
end $$;

revoke execute on function merge_contacts(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Same lockdown as every other table: only the app server reads and writes.
-- Claude's optional SELECT-only role never sees the rating.
-- ---------------------------------------------------------------------------
alter table musician_profiles enable row level security;
alter table musician_gigs     enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on musician_profiles, musician_gigs from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'crm_reader') then
    execute 'revoke all on musician_profiles from crm_reader';
    execute 'grant select (contact_id, instruments, based_in, website, roster, notes, created_at, updated_at) on musician_profiles to crm_reader';
    execute 'grant select on musician_gigs to crm_reader';
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'musician_profiles' and policyname = 'crm_reader_select') then
      execute 'create policy crm_reader_select on musician_profiles for select to crm_reader using (true)';
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'musician_gigs' and policyname = 'crm_reader_select') then
      execute 'create policy crm_reader_select on musician_gigs for select to crm_reader using (true)';
    end if;
  end if;
end $$;
