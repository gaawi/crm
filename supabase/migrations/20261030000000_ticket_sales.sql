-- Tickets sold per concert and sales channel (TDF, Theater Club, the website...).
-- ChatGPT keeps the numbers up to date straight in the database; the app shows
-- them on the concert's page in Concert list.

create table concert_ticket_sales (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references listing_events (id) on delete cascade,
  channel    text not null check (char_length(channel) between 1 and 80),
  sold       integer check (sold >= 0),
  note       text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index concert_ticket_sales_channel_once on concert_ticket_sales (event_id, lower(channel));
alter table concert_ticket_sales enable row level security;
create trigger concert_ticket_sales_updated_at before update on concert_ticket_sales for each row execute function set_updated_at();

comment on table concert_ticket_sales is
  'Tickets sold for a concert, one row per sales channel. event_id -> listing_events.id (find it with: select id, title, starts_at from listing_events order by starts_at). Each New York concert starts with the rows TDF, Theater Club and Website (sold null = not reported yet): update sold on the existing row; insert a new row only for a channel that is not there yet.';
comment on column concert_ticket_sales.channel is 'Where the tickets were sold: TDF, Theater Club, Website (creartbox.nyc), or another channel by name.';
comment on column concert_ticket_sales.sold is 'Total tickets sold so far through this channel for this concert (the running total, not the sales since last time). Null until reported.';
comment on column concert_ticket_sales.note is 'Optional: anything worth knowing about these sales (e.g. "comps not included", "as of Oct 26").';
comment on column concert_ticket_sales.updated_at is 'Set automatically when the row changes: shown in the app as when the number was last updated.';

-- The usual channels for every New York concert, now and when one is added.
create function seed_ticket_channels() returns trigger language plpgsql as $$
begin
  if new.promote then
    insert into concert_ticket_sales (event_id, channel)
    select new.id, c from unnest(array['TDF', 'Theater Club', 'Website']) as c
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger listing_events_ticket_channels after insert on listing_events for each row execute function seed_ticket_channels();

insert into concert_ticket_sales (event_id, channel)
select e.id, c from listing_events e cross join unnest(array['TDF', 'Theater Club', 'Website']) as c
 where e.promote
on conflict do nothing;
