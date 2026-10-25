-- Why a site is still pending for a concert, written by whoever does the
-- submissions (ChatGPT works straight in the database). The comments below
-- are the instructions it reads.

alter table listing_submissions
  add column pending_reason text check (char_length(pending_reason) <= 2000);

comment on table listing_submissions is
  'One row per concert (event_id -> listing_events) and site (platform_id -> listing_platforms): where that concert was sent and what happened. Unique on (event_id, platform_id): insert ... on conflict (event_id, platform_id) do update. To find the ids, read the view promotion_checklist.';
comment on column listing_submissions.status is
  'todo (pending, not sent), sent, received (they confirmed), published, rejected, blocked (could not send), skipped.';
comment on column listing_submissions.pending_reason is
  'WHY IT IS STILL PENDING. Fill it whenever status is todo or blocked: what exactly stops the submission (captcha, login, payment asked, form closed, missing image...) and what is needed from the owner. One or two plain sentences. The owner reviews these one by one in the app. Leave as is once the site is sent or published.';
comment on column listing_submissions.public_url is
  'The public listing as people see it (the page on their site). Always fill it when status is published.';
comment on column listing_submissions.confirmation_url is
  'Proof of the submission: confirmation page, ticket or email link.';
comment on column listing_submissions.notes is
  'Anything else about this concert on this site. The reason it is pending goes in pending_reason, not here.';

-- Rows that were pending before this column existed kept the reason in notes.
update listing_submissions set pending_reason = notes where status in ('todo', 'blocked') and notes is not null;

-- Every concert with every site it goes to (tier always or sometimes), with
-- the ids to write back and the current state, even before a row exists.
create view promotion_checklist with (security_invoker = true) as
select e.id as event_id, e.title as concert, (e.starts_at at time zone e.time_zone)::date as concert_date,
       p.id as platform_id, p.name as site, p.kind, p.tier, p.method,
       coalesce(s.status, 'todo') as status, s.pending_reason, s.sent_at, s.public_url, s.confirmation_url, s.notes,
       s.id as submission_id
  from listing_events e
  cross join listing_platforms p
  left join listing_submissions s on s.event_id = e.id and s.platform_id = p.id
 where p.tier <> 'skip';

comment on view promotion_checklist is
  'Read-only checklist: one row per concert and site. To write, upsert into listing_submissions using event_id and platform_id from here.';
