-- ============================================================================
-- Run log of the daily campaign assistant.
--
-- Every run of the routine opens a row (POST /api/assistant-agent/runs) and
-- closes it with its report; every write it makes through the API (proposals,
-- contact cards, profiles, photos) is recorded with what it sent and what the
-- app answered, so each run can be audited afterwards: what was revised,
-- proposed, skipped and why.
--
-- Idempotent: safe to run twice.
-- ============================================================================

create table if not exists assistant_runs (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  model        text,
  -- The routine's own summary for the owner (Spanish).
  report       text,
  created_at   timestamptz not null default now()
);
create index if not exists assistant_runs_started_idx on assistant_runs (started_at desc);

create table if not exists assistant_api_calls (
  id        bigint generated always as identity primary key,
  run_id    uuid references assistant_runs (id) on delete cascade,
  at        timestamptz not null default now(),
  endpoint  text not null,
  status    integer not null,
  request   jsonb,
  response  jsonb
);
create index if not exists assistant_api_calls_run_idx on assistant_api_calls (run_id, at);
create index if not exists assistant_api_calls_at_idx on assistant_api_calls (at desc);

alter table assistant_runs      enable row level security;
alter table assistant_api_calls enable row level security;
