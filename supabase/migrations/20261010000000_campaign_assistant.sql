-- ============================================================================
-- Daily campaign assistant.
--
-- An external routine (Claude Code, scheduled) reads the active booking
-- sheets through /api/assistant-agent/context and writes proposals back
-- through /api/assistant-agent/proposals. Nothing is sent without the
-- owner's explicit approval.
--
--   projects.assistant_active       Active / Paused per sheet (default paused)
--   projects.assistant_brief        the owner's goals and instructions
--   projects.assistant_last_run_at  last time the routine wrote proposals
--   assistant_actions               recommended next actions (email, call,
--                                   WhatsApp, task) the owner completes,
--                                   postpones or dismisses
--   email_drafts                    + revision_request, postponed_until,
--                                   assistant_reason; status + postponed,
--                                   changes_requested
--
-- Idempotent: safe to run twice.
-- ============================================================================

alter table projects add column if not exists assistant_active boolean not null default false;
alter table projects add column if not exists assistant_brief text;
alter table projects add column if not exists assistant_last_run_at timestamptz;

create table if not exists assistant_actions (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  opportunity_id   uuid references opportunities (id) on delete set null,
  contact_id       uuid references contacts (id) on delete set null,
  kind             text not null check (kind in ('email', 'call', 'whatsapp', 'task')),
  title            text not null check (btrim(title) <> ''),
  reason           text,
  priority         smallint not null default 2 check (priority between 1 and 3),
  status           text not null default 'open' check (status in ('open', 'done', 'postponed', 'dismissed')),
  postponed_until  date,
  draft_id         uuid references email_drafts (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index if not exists assistant_actions_project_idx on assistant_actions (project_id, status, priority, created_at desc);
create index if not exists assistant_actions_open_idx on assistant_actions (status, priority, created_at desc)
  where status in ('open', 'postponed');
create index if not exists assistant_actions_opportunity_idx on assistant_actions (opportunity_id);
create index if not exists assistant_actions_draft_idx on assistant_actions (draft_id) where draft_id is not null;
drop trigger if exists assistant_actions_updated_at on assistant_actions;
create trigger assistant_actions_updated_at before update on assistant_actions
  for each row execute function set_updated_at();

alter table email_drafts add column if not exists revision_request text;
alter table email_drafts add column if not exists postponed_until date;
alter table email_drafts add column if not exists assistant_reason text;
create index if not exists email_drafts_assistant_idx on email_drafts (status, created_at desc)
  where assistant_reason is not null;

alter table email_drafts drop constraint if exists email_drafts_status_check;
alter table email_drafts add constraint email_drafts_status_check
  check (status in ('proposed', 'queued', 'revising', 'sending', 'sent', 'discarded', 'failed',
                    'postponed', 'changes_requested'));

-- ---------------------------------------------------------------------------
-- Same lockdown as every other table: only the app server reads and writes.
-- ---------------------------------------------------------------------------
alter table assistant_actions enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on assistant_actions from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'crm_reader') then
    execute 'grant select on assistant_actions to crm_reader';
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_actions' and policyname = 'crm_reader_select') then
      execute 'create policy crm_reader_select on assistant_actions for select to crm_reader using (true)';
    end if;
  end if;
end $$;
