-- ============================================================================
-- Goals, next steps and gradual email campaigns.
--
--   opportunities.kind          the goal with a contact / organization (get
--                               booked, a donation, a space lent, press…)
--   opportunities.next_action   the structured next step (call, send the full
--                               proposal, sign the contract…); next_step stays
--                               the free-text detail and follow_up_at the date
--   email_templates.trigger     + keep_informed, thanks
--   email_campaigns             emails the owner approved as a batch, sent a
--                               few at a time by the cron (never before the
--                               owner's "Approve and start sending")
--   email_drafts.campaign_id    the campaign a proposal belongs to
--   email_drafts.status         + queued (approved, waiting its turn)
--
-- Idempotent: safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Goal kinds (every earlier value is kept).
-- ---------------------------------------------------------------------------
alter table opportunities drop constraint if exists opportunities_kind_check;
alter table opportunities add constraint opportunities_kind_check
  check (kind in ('booking', 'perform_with', 'residency', 'education', 'broadcast',
                  'venue', 'exchange', 'fundraising', 'sponsorship', 'grant',
                  'partnership', 'coproduction', 'network', 'introduction',
                  'press', 'sale', 'other'));

-- ---------------------------------------------------------------------------
-- Structured next step.
-- ---------------------------------------------------------------------------
alter table opportunities add column if not exists next_action text;
alter table opportunities drop constraint if exists opportunities_next_action_check;
alter table opportunities add constraint opportunities_next_action_check
  check (next_action is null or next_action in (
    'first_contact', 'call', 'send_proposal', 'send_materials', 'follow_up', 'meeting',
    'agree_terms', 'send_contract', 'close_contract', 'logistics', 'invoice',
    'thank_report', 'keep_informed', 'wait_reply'));

-- ---------------------------------------------------------------------------
-- Template situations: keep contacts informed of our news, thanks after the event.
-- ---------------------------------------------------------------------------
alter table email_templates drop constraint if exists email_templates_trigger_check;
alter table email_templates add constraint email_templates_trigger_check
  check (trigger in ('first_contact', 'returning', 'follow_up', 'after_call', 'next_steps',
                     'confirmed', 'declined', 'keep_informed', 'thanks', 'custom'));

-- ---------------------------------------------------------------------------
-- Campaigns. Sending rules (enforced by lib/campaigns/scheduler.ts on every
-- send): only inside [window_start, window_end) hours in `timezone` (and on
-- weekdays when weekdays_only), at least 3600 / per_hour seconds apart, at
-- most daily_cap per day. locked_until is the scheduler's lease.
-- ---------------------------------------------------------------------------
create table if not exists email_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (btrim(name) <> ''),
  project_id            uuid references projects (id) on delete set null,
  account_id            uuid not null references gmail_accounts (id) on delete cascade,
  status                text not null default 'draft'
                          check (status in ('draft', 'running', 'paused', 'done', 'cancelled')),
  per_hour              integer not null default 10 check (per_hour between 1 and 60),
  daily_cap             integer not null default 40 check (daily_cap between 1 and 400),
  window_start          smallint not null default 9 check (window_start between 0 and 23),
  window_end            smallint not null default 19 check (window_end between 1 and 24),
  weekdays_only         boolean not null default true,
  timezone              text not null default 'Europe/Madrid',
  last_sent_at          timestamptz,
  locked_until          timestamptz,
  consecutive_failures  integer not null default 0,
  error                 text,
  started_at            timestamptz,
  finished_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint email_campaigns_window_check check (window_end > window_start)
);
create index if not exists email_campaigns_status_idx on email_campaigns (status, created_at desc);
create index if not exists email_campaigns_account_idx on email_campaigns (account_id);
drop trigger if exists email_campaigns_updated_at on email_campaigns;
create trigger email_campaigns_updated_at before update on email_campaigns
  for each row execute function set_updated_at();

alter table email_drafts add column if not exists campaign_id uuid references email_campaigns (id) on delete set null;
create index if not exists email_drafts_campaign_idx on email_drafts (campaign_id, status, created_at)
  where campaign_id is not null;

-- The owner checked a held-back email and put it back in the queue: the
-- sender's "did they get in touch since?" check starts here instead of at
-- created_at (otherwise the same reply would hold it back again).
alter table email_drafts add column if not exists hold_cleared_at timestamptz;

alter table email_drafts drop constraint if exists email_drafts_status_check;
alter table email_drafts add constraint email_drafts_status_check
  check (status in ('proposed', 'queued', 'revising', 'sending', 'sent', 'discarded', 'failed'));

-- ---------------------------------------------------------------------------
-- Same lockdown as every other table: only the app server reads and writes.
-- ---------------------------------------------------------------------------
alter table email_campaigns enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on email_campaigns from anon, authenticated';
  end if;
  -- The optional SELECT-only role for Claude's query_database tool
  -- (supabase/optional/readonly-role.sql), when it was created.
  if exists (select 1 from pg_roles where rolname = 'crm_reader') then
    execute 'grant select on email_campaigns to crm_reader';
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_campaigns' and policyname = 'crm_reader_select') then
      execute 'create policy crm_reader_select on email_campaigns for select to crm_reader using (true)';
    end if;
  end if;
end $$;
