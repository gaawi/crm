-- What their answer was (a second status next to the email status): set by hand or from reading the replies.
alter table opportunities add column if not exists response text
  check (response is null or response in ('interested','considering','later','not_a_fit','played_before'));

comment on column opportunities.response is
  'Their answer, a second status next to stage: interested (wants info, dates or fee), considering (reviewing the proposal or passed it to programming), later (not now, a future season or keep on file), not_a_fit (said we do not fit; usually stage lost too), played_before (we have already played there). Empty = no answer yet or not classified. ChatGPT: set it after reading the presenter''s reply; find the row by organizations.name joined on opportunities.organization_id in the Booking USA project (f195d409-8cb8-4471-9bd3-516ef779c3e5); never set it without a reply or a known past concert.';
