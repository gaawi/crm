-- ============================================================================
-- Booking tracker: phones, sections, a log of calls / WhatsApp / meetings /
-- notes, and email templates per booking sheet.
--
--   contacts.phone / whatsapp      normalized: digits with an optional leading +
--   opportunities.sheet_section    the row's group within a sheet ("Cultura en Rede")
--   opportunities.is_returning     worked together before
--   activities                     everything that is not a synced email
--   email_templates                per sheet (project_id) or global (null)
--
-- Idempotent: safe to run twice.
-- ============================================================================

alter table contacts add column if not exists phone text check (phone ~ '^\+?[0-9]{6,16}$');
alter table contacts add column if not exists whatsapp text check (whatsapp ~ '^\+?[0-9]{6,16}$');

-- Where the row sits in its sheet, the halls/spaces at that venue, and
-- whether we worked together before ("Previo" in the old tracker;
-- `returning` itself is a reserved word).
alter table opportunities add column if not exists sheet_section text;
alter table opportunities add column if not exists spaces text;
alter table opportunities add column if not exists is_returning boolean not null default false;

-- Country code for numbers typed without one in this sheet (e.g. '+34'), and
-- the mailbox used when preparing emails from it.
alter table projects add column if not exists phone_prefix text check (phone_prefix ~ '^\+[0-9]{1,4}$');
alter table projects add column if not exists send_account_id uuid references gmail_accounts (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Activities: calls, WhatsApp, meetings, emails logged by hand (sent from an
-- account that is not connected, or a postal exchange), notes, and automatic
-- status-change entries ("To contact → Contacted").
-- ---------------------------------------------------------------------------
create table if not exists activities (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('call', 'whatsapp', 'meeting', 'email', 'note', 'status')),
  -- Calls only.
  outcome          text check (outcome in ('reached', 'no_answer', 'voicemail', 'call_back', 'wrong_number')),
  body             text,
  occurred_at      timestamptz not null default now(),
  contact_id       uuid references contacts (id) on delete set null,
  organization_id  uuid references organizations (id) on delete set null,
  opportunity_id   uuid references opportunities (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (contact_id is not null or organization_id is not null or opportunity_id is not null),
  check (outcome is null or kind = 'call')
);
create index if not exists activities_contact_idx on activities (contact_id, occurred_at desc);
create index if not exists activities_opportunity_idx on activities (opportunity_id, occurred_at desc);
create index if not exists activities_organization_idx on activities (organization_id, occurred_at desc);

-- An activity left with nothing to belong to is deleted with its last owner
-- (the "set null" above would otherwise violate the check).
create or replace function activities_drop_orphans() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'contacts' then
    delete from activities where contact_id = old.id and organization_id is null and opportunity_id is null;
  elsif tg_table_name = 'organizations' then
    delete from activities where organization_id = old.id and contact_id is null and opportunity_id is null;
  else
    delete from activities where opportunity_id = old.id and contact_id is null and organization_id is null;
  end if;
  return old;
end $$;

drop trigger if exists contacts_drop_orphan_activities on contacts;
create trigger contacts_drop_orphan_activities before delete on contacts
  for each row execute function activities_drop_orphans();
drop trigger if exists organizations_drop_orphan_activities on organizations;
create trigger organizations_drop_orphan_activities before delete on organizations
  for each row execute function activities_drop_orphans();
drop trigger if exists opportunities_drop_orphan_activities on opportunities;
create trigger opportunities_drop_orphan_activities before delete on opportunities
  for each row execute function activities_drop_orphans();

-- ---------------------------------------------------------------------------
-- Email templates. trigger = the situation a template is suggested for.
-- ---------------------------------------------------------------------------
create table if not exists email_templates (
  id          uuid primary key default gen_random_uuid(),
  -- null = available in every sheet.
  project_id  uuid references projects (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  trigger     text not null check (trigger in ('first_contact', 'returning', 'follow_up', 'after_call',
                                               'next_steps', 'confirmed', 'declined', 'custom')),
  subject     text not null,
  body        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists email_templates_project_idx on email_templates (project_id, sort_order);
drop trigger if exists email_templates_updated_at on email_templates;
create trigger email_templates_updated_at before update on email_templates
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- last_contacted_at also counts calls (when someone answered or asked to be
-- called back), WhatsApp, meetings and hand-logged emails. Everything else
-- stays email-based (awaiting_reply_since in particular).
-- ---------------------------------------------------------------------------
create or replace function refresh_contact_stats(p_contact_ids uuid[])
returns void
language plpgsql as $$
begin
  -- Lock in a deterministic order so concurrent refreshes cannot deadlock,
  -- then compute with a snapshot taken after the locks are held.
  perform 1 from contacts where id = any (p_contact_ids) order by id for update;

  with ids as (
    select distinct unnest(p_contact_ids) as contact_id
  ),
  rows as (
    select ce.contact_id, m.id as message_id, m.account_id, m.gmail_thread_id, m.sent_at, m.direction, mp.role,
           coalesce(m.rfc822_message_id, m.id::text) as message_key,
           (not m.is_automated
             or (m.automated_reason in ('unsubscribe', 'category')
                 and exists (select 1 from messages o
                              where o.account_id = m.account_id
                                and o.gmail_thread_id = m.gmail_thread_id
                                and o.direction = 'outbound'))) as human
      from contact_emails ce
      join message_participants mp on mp.email = ce.email
      join messages m on m.id = mp.message_id
     where ce.contact_id = any (p_contact_ids)
  ),
  stats as (
    select contact_id,
           max(sent_at) filter (where direction = 'inbound' and role in ('from', 'reply_to') and human) as in_at,
           max(sent_at) filter (where direction = 'outbound' and role = 'to') as out_at,
           max(sent_at) filter (where direction = 'outbound' and role in ('to', 'cc', 'bcc')) as out_any_at,
           max(sent_at) filter (
             where direction = 'outbound' and role = 'to'
               and not exists (select 1 from messages r
                                where r.account_id = rows.account_id
                                  and r.gmail_thread_id = rows.gmail_thread_id
                                  and r.direction = 'inbound'
                                  and r.sent_at > rows.sent_at)
           ) as awaiting_at,
           count(distinct message_key)::integer as cnt
      from rows
     group by contact_id
  ),
  touches as (
    select a.contact_id, max(a.occurred_at) as touch_at
      from activities a
     where a.contact_id = any (p_contact_ids)
       and a.kind in ('call', 'whatsapp', 'meeting', 'email')
       and (a.kind <> 'call' or a.outcome is null or a.outcome in ('reached', 'call_back'))
     group by a.contact_id
  )
  update contacts c
     set last_contacted_at    = greatest(s.in_at, s.out_any_at, t.touch_at),
         last_inbound_at      = s.in_at,
         last_outbound_at     = s.out_at,
         awaiting_reply_since = s.awaiting_at,
         message_count        = coalesce(s.cnt, 0)
    from ids
    left join stats s on s.contact_id = ids.contact_id
    left join touches t on t.contact_id = ids.contact_id
   where c.id = ids.contact_id
     and (c.last_contacted_at, c.last_inbound_at, c.last_outbound_at, c.awaiting_reply_since, c.message_count)
         is distinct from (greatest(s.in_at, s.out_any_at, t.touch_at), s.in_at, s.out_at, s.awaiting_at, coalesce(s.cnt, 0));
end $$;

-- Merging two contacts also moves the source's activities (and fills phones).
create or replace function merge_contacts(p_target uuid, p_source uuid)
returns void
language plpgsql as $$
declare
  s contacts%rowtype;
  t contacts%rowtype;
begin
  if p_target = p_source then
    raise exception 'cannot merge a contact into itself';
  end if;

  -- Lock both rows in id order.
  perform 1 from contacts where id in (p_target, p_source) order by id for update;
  select * into t from contacts where id = p_target;
  if not found then
    raise exception 'target contact % not found', p_target;
  end if;
  select * into s from contacts where id = p_source;
  if not found then
    raise exception 'source contact % not found', p_source;
  end if;

  -- Keep the target's primary address; the source's primary becomes primary
  -- only if the target has none.
  update contact_emails
     set contact_id = p_target,
         is_primary = is_primary and not exists (
           select 1 from contact_emails x where x.contact_id = p_target and x.is_primary)
   where contact_id = p_source;

  insert into contact_projects (contact_id, project_id)
  select p_target, project_id from contact_projects where contact_id = p_source
  on conflict do nothing;

  update opportunities set contact_id = p_target where contact_id = p_source;
  update activities set contact_id = p_target where contact_id = p_source;

  update contacts c
     set name            = coalesce(nullif(btrim(t.name), ''), s.name),
         organization_id = coalesce(t.organization_id, s.organization_id),
         role            = coalesce(nullif(btrim(t.role), ''), s.role),
         phone           = coalesce(t.phone, s.phone),
         whatsapp        = coalesce(t.whatsapp, s.whatsapp),
         notes           = case
                             when coalesce(btrim(s.notes), '') = '' then t.notes
                             when coalesce(btrim(t.notes), '') = '' then s.notes
                             else t.notes || E'\n\n' || s.notes
                           end,
         tags            = array(select distinct x from unnest(t.tags || s.tags) as x order by x),
         -- The earliest follow-up wins, with its own note.
         (follow_up_at, follow_up_note) = (
           select d, n from (values (t.follow_up_at, t.follow_up_note), (s.follow_up_at, s.follow_up_note)) v(d, n)
            order by d nulls last limit 1),
         status          = case
                             when t.status = 'new' and s.status <> 'archived' then s.status
                             else t.status
                           end,
         source          = case
                             when t.source = 'manual' or s.source = 'manual' then 'manual'
                             else 'gmail'
                           end,
         reply_dismissed_at = greatest(t.reply_dismissed_at, s.reply_dismissed_at)
   where c.id = p_target;

  delete from contacts where id = p_source;

  perform refresh_contact_stats(array[p_target]);
end $$;

revoke execute on function refresh_contact_stats(uuid[]) from public;
revoke execute on function merge_contacts(uuid, uuid) from public;
revoke execute on function activities_drop_orphans() from public;

-- ---------------------------------------------------------------------------
-- Same lockdown as every other table: only the app server reads and writes.
-- ---------------------------------------------------------------------------
alter table activities      enable row level security;
alter table email_templates enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on activities, email_templates from anon, authenticated';
    execute 'revoke execute on function activities_drop_orphans() from anon, authenticated';
  end if;
  -- The optional SELECT-only role for Claude's query_database tool
  -- (supabase/optional/readonly-role.sql), when it was created.
  if exists (select 1 from pg_roles where rolname = 'crm_reader') then
    execute 'grant select on activities, email_templates to crm_reader';
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'crm_reader_select') then
      execute 'create policy crm_reader_select on activities for select to crm_reader using (true)';
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_templates' and policyname = 'crm_reader_select') then
      execute 'create policy crm_reader_select on email_templates for select to crm_reader using (true)';
    end if;
  end if;
end $$;
