-- Ticket channels: the website sells through Eventbrite (one channel, not two),
-- and Culture Pass joins TDF and Theater Club. The owner can also set the
-- numbers and add channels by hand on the concert's page.

update concert_ticket_sales set channel = 'Eventbrite (website)' where channel = 'Website';

create or replace function seed_ticket_channels() returns trigger language plpgsql as $$
begin
  if new.promote then
    insert into concert_ticket_sales (event_id, channel)
    select new.id, c from unnest(array['TDF', 'Theater Club', 'Culture Pass', 'Eventbrite (website)']) as c
    on conflict do nothing;
  end if;
  return new;
end $$;

insert into concert_ticket_sales (event_id, channel)
select e.id, 'Culture Pass' from listing_events e where e.promote
on conflict do nothing;

comment on table concert_ticket_sales is
  'Tickets sold for a concert, one row per sales channel. event_id -> listing_events.id (find it with: select id, title, starts_at from listing_events order by starts_at). Each New York concert starts with the rows TDF, Theater Club, Culture Pass and Eventbrite (website) (sold null = not reported yet): update sold on the existing row; insert a new row only for a channel that is not there yet. The owner may also edit these numbers by hand in the app.';
comment on column concert_ticket_sales.channel is 'Where the tickets were sold: TDF, Theater Club, Culture Pass, Eventbrite (website) (the website sells through Eventbrite: one channel), or another channel by name.';
