-- ============================================================================
-- Promotion: the partners, editors, calendars and newsletters every concert
-- is sent to (TDF, Culture Pass, Time Out, BroadwayWorld, The Skint…), and,
-- for each concert, where it was sent and what happened.
--
--   listing_platforms    one row per partner or outlet
--     kind               'partner' (tickets / audiences: TDF, Culture Pass) | 'editorial'
--                        (editors, critics) | 'calendar' | 'newsletter' | 'aggregator' | 'other'
--     tier               'always' (part of every concert's routine) | 'sometimes' | 'skip'
--     fields             what their form or email asks for
--     method             'form' | 'email' | 'account' (post from a login) | 'other'
--     login_required     the account it needs (which email or "Google", never a password)
--     cost               'free' | 'paid' | 'unknown', with cost_note ("25 USD per concert")
--     lead_days          how far ahead they want it (NYC Tourism: 21)
--   listing_events       the concerts we promote (title, date, venue, tickets…)
--   listing_submissions  one row per concert × platform: status, when, how,
--                        the confirmation and the public listing
--
-- Idempotent: safe to run twice.
-- ============================================================================

create table if not exists listing_platforms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 1 and 200),
  website         text check (website is null or (website ~ '^https?://[^\s/]+[^\s]*$' and length(website) <= 2048)),
  submit_url      text check (submit_url is null or (submit_url ~ '^https?://[^\s/]+[^\s]*$' and length(submit_url) <= 2048)),
  email           text check (email is null or length(email) <= 320),
  kind            text not null default 'calendar'
                  check (kind in ('partner', 'editorial', 'calendar', 'newsletter', 'aggregator', 'other')),
  tier            text not null default 'sometimes' check (tier in ('always', 'sometimes', 'skip')),
  method          text not null default 'form' check (method in ('form', 'email', 'account', 'other')),
  login_required  boolean not null default false,
  login_account   text check (login_account is null or length(login_account) <= 300),
  cost            text not null default 'unknown' check (cost in ('free', 'paid', 'unknown')),
  cost_note       text check (cost_note is null or length(cost_note) <= 300),
  lead_days       smallint check (lead_days is null or lead_days between 0 and 365),
  audience        text check (audience is null or length(audience) <= 300),
  fields          text check (fields is null or length(fields) <= 2000),
  instructions    text check (instructions is null or length(instructions) <= 4000),
  notes           text check (notes is null or length(notes) <= 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists listing_platforms_name_idx on listing_platforms (lower(name));
drop trigger if exists listing_platforms_updated_at on listing_platforms;
create trigger listing_platforms_updated_at before update on listing_platforms
  for each row execute function set_updated_at();

create table if not exists listing_events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 1 and 300),
  starts_at    timestamptz not null,
  time_zone    text not null default 'America/New_York' check (length(time_zone) between 1 and 64),
  venue        text check (venue is null or length(venue) <= 300),
  address      text check (address is null or length(address) <= 500),
  ticket_url   text check (ticket_url is null or (ticket_url ~ '^https?://[^\s/]+[^\s]*$' and length(ticket_url) <= 2048)),
  info_url     text check (info_url is null or (info_url ~ '^https?://[^\s/]+[^\s]*$' and length(info_url) <= 2048)),
  image_url    text check (image_url is null or (image_url ~ '^https?://[^\s/]+[^\s]*$' and length(image_url) <= 2048)),
  prices       text check (prices is null or length(prices) <= 300),
  description  text check (description is null or length(description) <= 6000),
  notes        text check (notes is null or length(notes) <= 4000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists listing_events_starts_idx on listing_events (starts_at desc);
drop trigger if exists listing_events_updated_at on listing_events;
create trigger listing_events_updated_at before update on listing_events
  for each row execute function set_updated_at();

create table if not exists listing_submissions (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references listing_events (id) on delete cascade,
  platform_id       uuid not null references listing_platforms (id) on delete cascade,
  status            text not null default 'todo'
                    check (status in ('todo', 'sent', 'received', 'published', 'rejected', 'blocked', 'skipped')),
  sent_at           date,
  sent_by           text check (sent_by is null or length(sent_by) <= 100),
  confirmation_url  text check (confirmation_url is null or (confirmation_url ~ '^https?://[^\s/]+[^\s]*$' and length(confirmation_url) <= 2048)),
  public_url        text check (public_url is null or (public_url ~ '^https?://[^\s/]+[^\s]*$' and length(public_url) <= 2048)),
  notes             text check (notes is null or length(notes) <= 4000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_id, platform_id)
);
create index if not exists listing_submissions_platform_idx on listing_submissions (platform_id);
drop trigger if exists listing_submissions_updated_at on listing_submissions;
create trigger listing_submissions_updated_at before update on listing_submissions
  for each row execute function set_updated_at();

alter table listing_platforms   enable row level security;
alter table listing_events      enable row level security;
alter table listing_submissions enable row level security;
