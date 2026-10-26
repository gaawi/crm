-- Staff and artists on a concert's list: what they do, how to reach them and
-- when they are due (the call time the owner gave them).

alter table concert_guests
  add column role text check (char_length(role) <= 100),
  add column phone text check (char_length(phone) <= 40),
  add column call_time time;

comment on column concert_guests.role is 'For staff and artists: what they do that day (camera, usher, violin, sound...).';
comment on column concert_guests.phone is 'A phone number to reach them on the day (copied from their contact when added from the CRM).';
comment on column concert_guests.call_time is 'The time they were told to arrive (local time of the concert), e.g. 17:00.';
