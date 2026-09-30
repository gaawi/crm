-- ============================================================================
-- CRM schema v1
--
-- Single-owner CRM fed by several Gmail accounts.
--
--   gmail_accounts ─┬─< messages ─< message_participants (email) >─ contact_emails >─ contacts
--                   │                                                              │
--                   │   organizations ─< contacts >─< contact_projects >─ projects │
--                   │                                                              │
--                   └── opportunities (contact / organization / project) ──────────┘
--
-- Key idea: messages are linked to contacts *by email address*, through
-- message_participants.email = contact_emails.email. A contact owns any number
-- of addresses, so one person's history is merged across all addresses and all
-- connected Gmail accounts automatically, and merging two contacts is just
-- moving contact_emails rows.
--
-- All access goes through the Next.js server with the privileged connection
-- (DATABASE_URL). RLS is enabled with no policies, so the Supabase anon /
-- authenticated API roles can read nothing.
-- ============================================================================

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Connected Gmail accounts + sync state
-- ---------------------------------------------------------------------------
create table gmail_accounts (
  id                      uuid primary key default gen_random_uuid(),
  email                   text not null unique check (email = lower(email)),
  display_name            text,
  -- "Send mail as" addresses of this mailbox (lowercase). Never become contacts.
  aliases                 text[] not null default '{}',
  status                  text not null default 'active'
                            check (status in ('active', 'reauth_required', 'disconnected')),
  scopes                  text[] not null default '{}',
  -- OAuth tokens, AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY.
  refresh_token_enc       text,
  access_token_enc        text,
  access_token_expires_at timestamptz,

  -- Incremental sync (Gmail history API + Pub/Sub push).
  history_id              bigint,          -- last fully processed mailbox historyId
  last_synced_at          timestamptz,
  sync_locked_until       timestamptz,     -- lease lock: one incremental run at a time
  sync_requested          boolean not null default false, -- a push arrived while locked
  watch_expires_at        timestamptz,     -- users.watch expiration (renew before)

  -- Initial historical import.
  backfill_status         text not null default 'pending'
                            check (backfill_status in ('pending', 'running', 'done', 'error')),
  backfill_query          text,            -- Gmail search query used for the import
  backfill_page_token     text,            -- resume cursor for messages.list
  backfill_scanned        integer not null default 0,  -- message ids listed so far
  backfill_imported       integer not null default 0,  -- messages stored so far
  backfill_estimate       integer,         -- mailbox size estimate, for progress display
  backfill_started_at     timestamptz,
  backfill_completed_at   timestamptz,
  backfill_locked_until   timestamptz,     -- lease lock: one import run at a time

  last_error              text,
  last_error_at           timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger gmail_accounts_updated_at before update on gmail_accounts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  -- Email domains owned by the organization (lowercase, e.g. {'moma.org'}).
  -- New contacts with a matching address are linked automatically.
  domains     text[] not null default '{}',
  website     text,
  notes       text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index organizations_name_key on organizations (lower(name));
create index organizations_domains_idx on organizations using gin (domains);
create trigger organizations_updated_at before update on organizations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Projects (CreArtBox, ADAR, Personal, Booking, Press, Grants, ...)
-- ---------------------------------------------------------------------------
create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  color       text not null default 'gray',
  description text,
  archived    boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index projects_name_key on projects (lower(name));
create trigger projects_updated_at before update on projects
  for each row execute function set_updated_at();

insert into projects (name, color, sort_order) values
  ('CreArtBox', 'violet', 1),
  ('ADAR',      'blue',   2),
  ('Personal',  'green',  3),
  ('Booking',   'amber',  4),
  ('Press',     'rose',   5),
  ('Grants',    'teal',   6);

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table contacts (
  id                  uuid primary key default gen_random_uuid(),
  name                text,
  organization_id     uuid references organizations (id) on delete set null,
  role                text,
  notes               text,
  tags                text[] not null default '{}',
  -- new = auto-created from Gmail and not reviewed yet; archived = hidden noise.
  status              text not null default 'new'
                        check (status in ('new', 'lead', 'active', 'inactive', 'archived')),
  follow_up_at        date,
  follow_up_note      text,
  source              text not null default 'manual' check (source in ('manual', 'gmail')),

  -- Denormalized from the email history by refresh_contact_stats().
  last_contacted_at   timestamptz,   -- latest non-automated message either way
  last_inbound_at     timestamptz,   -- latest message *from* them
  last_outbound_at    timestamptz,   -- latest message from me *to* them
  message_count       integer not null default 0,
  -- "Mark done" on needs-reply / awaiting-reply lists: hidden until newer mail.
  reply_dismissed_at  timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index contacts_organization_idx on contacts (organization_id);
create index contacts_last_contacted_idx on contacts (last_contacted_at desc nulls last);
create index contacts_follow_up_idx on contacts (follow_up_at) where follow_up_at is not null;
create index contacts_status_idx on contacts (status);
create index contacts_tags_idx on contacts using gin (tags);
create trigger contacts_updated_at before update on contacts
  for each row execute function set_updated_at();

-- One row per address; an address belongs to exactly one contact.
create table contact_emails (
  email       text primary key
                check (email = lower(email) and position('@' in email) > 1),
  contact_id  uuid not null references contacts (id) on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index contact_emails_contact_idx on contact_emails (contact_id);
create unique index contact_emails_one_primary on contact_emails (contact_id) where is_primary;

create table contact_projects (
  contact_id  uuid not null references contacts (id) on delete cascade,
  project_id  uuid not null references projects (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (contact_id, project_id)
);
create index contact_projects_project_idx on contact_projects (project_id);

-- ---------------------------------------------------------------------------
-- Email messages (one row per message per Gmail account)
-- ---------------------------------------------------------------------------
create table messages (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references gmail_accounts (id) on delete cascade,
  gmail_message_id    text not null,
  gmail_thread_id     text not null,
  -- RFC 822 Message-ID header. The same email seen by two connected accounts
  -- has two rows with the same value; history views de-duplicate on it.
  rfc822_message_id   text,
  in_reply_to         text,
  references_header   text,
  direction           text not null check (direction in ('inbound', 'outbound')),
  from_email          text,
  from_name           text,
  subject             text,
  snippet             text,
  -- Plain-text body with quoted replies stripped, capped in length.
  -- Null for automated/bulk mail (snippet only) to keep the database small.
  body_text           text,
  sent_at             timestamptz not null,
  label_ids           text[] not null default '{}',
  -- Newsletters, notifications, receipts... (List-Unsubscribe, Precedence, etc.)
  is_automated        boolean not null default false,
  has_attachments     boolean not null default false,
  attachments         jsonb not null default '[]',  -- [{filename, mimeType, size}]
  search              tsvector generated always as (
                        setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
                        setweight(to_tsvector('simple', coalesce(from_name, '') || ' ' || coalesce(from_email, '')), 'B') ||
                        setweight(to_tsvector('english', left(coalesce(body_text, snippet, ''), 20000)), 'C')
                      ) stored,
  created_at          timestamptz not null default now(),
  unique (account_id, gmail_message_id)
);
create index messages_sent_at_idx on messages (sent_at desc);
create index messages_thread_idx on messages (account_id, gmail_thread_id);
create index messages_rfc822_idx on messages (rfc822_message_id);
create index messages_search_idx on messages using gin (search);

-- reply_to is stored when it differs from the sender: contact-form services
-- (Squarespace, Typeform, ...) send from no-reply@ with the real person there.
create table message_participants (
  message_id  uuid not null references messages (id) on delete cascade,
  role        text not null check (role in ('from', 'to', 'cc', 'bcc', 'reply_to')),
  email       text not null check (email = lower(email)),
  name        text,
  primary key (message_id, role, email)
);
create index message_participants_email_idx on message_participants (email, message_id);
-- Organization correspondence includes anyone at the organization's domains.
create index message_participants_domain_idx on message_participants (split_part(email, '@', 2));

-- ---------------------------------------------------------------------------
-- Pipeline
-- ---------------------------------------------------------------------------
create table opportunities (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (btrim(title) <> ''),
  stage            text not null default 'lead'
                     check (stage in ('lead', 'contacted', 'proposal', 'negotiation', 'won', 'lost')),
  contact_id       uuid references contacts (id) on delete set null,
  organization_id  uuid references organizations (id) on delete set null,
  project_id       uuid references projects (id) on delete set null,
  value            numeric(12, 2),
  currency         text not null default 'USD',
  follow_up_at     date,
  next_step        text,
  notes            text,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index opportunities_stage_idx on opportunities (stage);
create index opportunities_contact_idx on opportunities (contact_id);
create index opportunities_organization_idx on opportunities (organization_id);
create index opportunities_project_idx on opportunities (project_id);
create index opportunities_follow_up_idx on opportunities (follow_up_at) where follow_up_at is not null;
create trigger opportunities_updated_at before update on opportunities
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Recompute the denormalized history columns for the given contacts.
-- Call after inserting/deleting messages, and after moving addresses.
--
-- A message counts as real correspondence ("human") unless it is automated —
-- but an automated-looking message in a thread where I also wrote (a reply sent
-- through HubSpot/Mailchimp, say) still counts.
create or replace function refresh_contact_stats(p_contact_ids uuid[])
returns void
language sql as $$
  with ids as (
    select distinct unnest(p_contact_ids) as contact_id
  ),
  rows as (
    select ce.contact_id, m.sent_at, m.direction, mp.role,
           coalesce(m.rfc822_message_id, m.id::text) as message_key,
           (not m.is_automated
             or exists (select 1 from messages o
                         where o.account_id = m.account_id
                           and o.gmail_thread_id = m.gmail_thread_id
                           and o.direction = 'outbound')) as human
      from contact_emails ce
      join message_participants mp on mp.email = ce.email
      join messages m on m.id = mp.message_id
     where ce.contact_id = any (p_contact_ids)
  ),
  stats as (
    select contact_id,
           max(sent_at) filter (where human) as last_at,
           max(sent_at) filter (where direction = 'inbound' and role in ('from', 'reply_to') and human) as in_at,
           max(sent_at) filter (where direction = 'outbound' and role in ('to', 'cc', 'bcc')) as out_at,
           count(distinct message_key)::integer as cnt
      from rows
     group by contact_id
  )
  update contacts c
     set last_contacted_at = s.last_at,
         last_inbound_at   = s.in_at,
         last_outbound_at  = s.out_at,
         message_count     = coalesce(s.cnt, 0)
    from ids
    left join stats s on s.contact_id = ids.contact_id
   where c.id = ids.contact_id
     and (c.last_contacted_at, c.last_inbound_at, c.last_outbound_at, c.message_count)
         is distinct from (s.last_at, s.in_at, s.out_at, coalesce(s.cnt, 0));
$$;

-- Merge p_source into p_target: addresses, projects and opportunities move to
-- the target, empty target fields are filled from the source, tags are unioned,
-- notes are concatenated, and the source contact is deleted.
create or replace function merge_contacts(p_target uuid, p_source uuid)
returns void
language plpgsql as $$
declare
  s contacts%rowtype;
begin
  if p_target = p_source then
    raise exception 'cannot merge a contact into itself';
  end if;

  perform 1 from contacts where id = p_target for update;
  if not found then
    raise exception 'target contact % not found', p_target;
  end if;
  select * into s from contacts where id = p_source for update;
  if not found then
    raise exception 'source contact % not found', p_source;
  end if;

  update contact_emails set contact_id = p_target, is_primary = false
   where contact_id = p_source;

  insert into contact_projects (contact_id, project_id)
  select p_target, project_id from contact_projects where contact_id = p_source
  on conflict do nothing;

  update opportunities set contact_id = p_target where contact_id = p_source;

  update contacts t
     set name            = coalesce(t.name, s.name),
         organization_id = coalesce(t.organization_id, s.organization_id),
         role            = coalesce(t.role, s.role),
         notes           = case
                             when coalesce(btrim(s.notes), '') = '' then t.notes
                             when coalesce(btrim(t.notes), '') = '' then s.notes
                             else t.notes || E'\n\n' || s.notes
                           end,
         tags            = array(select distinct x from unnest(t.tags || s.tags) as x order by x),
         follow_up_at    = least(t.follow_up_at, s.follow_up_at),
         follow_up_note  = coalesce(t.follow_up_note, s.follow_up_note),
         status          = case
                             when t.status = 'new' and s.status <> 'archived' then s.status
                             else t.status
                           end,
         source          = case
                             when t.source = 'manual' or s.source = 'manual' then 'manual'
                             else 'gmail'
                           end
   where t.id = p_target;

  delete from contacts where id = p_source;

  perform refresh_contact_stats(array[p_target]);
end $$;

-- ---------------------------------------------------------------------------
-- Lock down the Supabase Data API: everything goes through the app server.
-- ---------------------------------------------------------------------------
alter table gmail_accounts       enable row level security;
alter table organizations        enable row level security;
alter table projects             enable row level security;
alter table contacts             enable row level security;
alter table contact_emails       enable row level security;
alter table contact_projects     enable row level security;
alter table messages             enable row level security;
alter table message_participants enable row level security;
alter table opportunities        enable row level security;

revoke execute on function refresh_contact_stats(uuid[]) from public;
revoke execute on function merge_contacts(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke execute on all functions in schema public from anon, authenticated';
  end if;
end $$;
