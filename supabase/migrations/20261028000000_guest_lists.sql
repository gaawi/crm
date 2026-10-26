-- Guest lists: who is on the door list of each concert, and how many tickets
-- they get. Added from Mail (one tap on the contact card) or the concert's
-- guest list page; checked in at the door.

-- Concerts away from New York (presenters' own seasons) have guest lists but
-- are not submitted to the New York listing sites of Promotion.
alter table listing_events add column promote boolean not null default true;
comment on column listing_events.promote is
  'Submitted to the New York listing sites and partners of Promotion. False for concerts elsewhere (they still have a guest list).';

create table concert_guests (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references listing_events (id) on delete cascade,
  contact_id    uuid references contacts (id) on delete set null,
  name          text not null check (char_length(name) between 1 and 200),
  email         text check (char_length(email) <= 320),
  tickets       smallint not null default 2 check (tickets between 1 and 20),
  kind          text not null default 'guest' check (kind in ('guest', 'staff', 'artist', 'press', 'partner')),
  note          text check (char_length(note) <= 1000),
  checked_in_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index concert_guests_contact_once on concert_guests (event_id, contact_id) where contact_id is not null;
create index concert_guests_event_idx on concert_guests (event_id);
alter table concert_guests enable row level security;
create trigger concert_guests_updated_at before update on concert_guests for each row execute function set_updated_at();

comment on table concert_guests is
  'The guest (door) list of a concert: one row per person, with how many tickets they get. event_id -> listing_events (the concert), contact_id -> contacts when the person is in the CRM. A contact is on a concert''s list at most once.';
comment on column concert_guests.tickets is 'Tickets for this person, themselves included (2 = they and a guest).';
comment on column concert_guests.kind is 'guest (complimentary), staff (ushers, crew), artist, press, partner (ticketing or community partner).';
comment on column concert_guests.note is 'Anything the door needs to know (e.g. "with her daughter", "pays at the door").';
comment on column concert_guests.checked_in_at is 'When they arrived (set at the door). Null until then.';
