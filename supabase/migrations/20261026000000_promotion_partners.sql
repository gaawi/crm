-- ============================================================================
-- Promotion: ticketing partners (TDF, Culture Pass, TheaterMania Gold Club,
-- PipTix). For each concert, how many tickets we offered them, at what price
-- for their members, and how many they took. Each partner keeps the email
-- addresses or domains we talk to them from (their emails show on its card)
-- and a summary of the relationship (how it works, contacts, history).
-- Idempotent: safe to run twice.
-- ============================================================================

alter table listing_platforms add column if not exists email_match text[] not null default '{}';
alter table listing_platforms add column if not exists relationship jsonb;

alter table listing_submissions add column if not exists tickets_offered smallint
  check (tickets_offered is null or tickets_offered between 0 and 10000);
alter table listing_submissions add column if not exists tickets_taken smallint
  check (tickets_taken is null or tickets_taken between 0 and 10000);
alter table listing_submissions add column if not exists member_price text
  check (member_price is null or length(member_price) <= 100);
