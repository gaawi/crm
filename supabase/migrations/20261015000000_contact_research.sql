-- The contact card filled by the campaign assistant before it writes an email
-- (POST /api/assistant-agent/contacts): when it was researched and the pages
-- the facts came from (official or professional sources only).
alter table contacts add column if not exists researched_at timestamptz;
alter table contacts add column if not exists research_sources text[] not null default '{}';

alter table contacts drop constraint if exists contacts_research_sources_max;
alter table contacts add constraint contacts_research_sources_max check (cardinality(research_sources) <= 20);
