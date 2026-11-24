-- Their answer is a warm-to-cold scale; having played there is the Returning mark (is_returning), not an answer.
update opportunities set response = null where response = 'played_before';
alter table opportunities drop constraint if exists opportunities_response_check;
alter table opportunities add constraint opportunities_response_check
  check (response is null or response in ('interested','later','considering','not_a_fit'));
comment on column opportunities.response is
  'Their answer, warm to cold: interested = "Wants to book" (asked for dates, fee or details for a coming season), later = "Interested, later" (real interest but a future season, or asked us to write again later), considering = "Acknowledged" (a polite receipt or passed to programming, no real signal), not_a_fit (said we do not fit; usually stage lost too). Empty = no answer yet. A past concert there is is_returning, not a response. ChatGPT: set it only after reading the presenter''s reply; find the row by organizations.name joined on opportunities.organization_id in the Booking USA project (f195d409-8cb8-4471-9bd3-516ef779c3e5).';
