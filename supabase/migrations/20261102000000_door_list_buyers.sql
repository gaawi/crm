-- Ticket buyers on the door list: the lists Eventbrite, PipTix, TDF... send on
-- the day are pasted in, one row per buyer, under the channel they came from.

alter table concert_guests drop constraint concert_guests_kind_check;
alter table concert_guests add constraint concert_guests_kind_check
  check (kind in ('guest', 'staff', 'artist', 'press', 'partner', 'buyer'));
alter table concert_guests add column source text check (char_length(source) <= 80);

comment on column concert_guests.kind is 'guest (complimentary), staff (ushers, crew), artist, press, partner (ticketing or community partner), buyer (bought a ticket: from the lists Eventbrite, PipTix, TDF... send on the day; see source).';
comment on column concert_guests.source is 'For buyers: the channel the list came from (Eventbrite, PipTix, TDF, Theater Club, Culture Pass...). Null for the owner''s own guests and staff. Buyers are listed by channel on the door list (and its PDF).';
