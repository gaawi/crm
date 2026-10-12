-- ============================================================================
-- Two agents share the run log: the writer (emails, twice a day) and the
-- prospector (finds and researches new prospects for the campaigns, every
-- morning). Each run says which agent it is; its API calls carry the run id
-- (X-Assistant-Run header) so overlapping runs never mix.
--
-- Idempotent: safe to run twice.
-- ============================================================================

alter table assistant_runs add column if not exists agent text not null default 'writer';
alter table assistant_runs drop constraint if exists assistant_runs_agent_check;
alter table assistant_runs add constraint assistant_runs_agent_check check (agent in ('writer', 'prospector'));
