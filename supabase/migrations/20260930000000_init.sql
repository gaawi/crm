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
  ('CreArtBox',   'violet', 1),
  ('ADAR',        'blue',   2),
  ('Personal',    'green',  3),
  ('Booking',     'amber',  4),
  ('Press',       'rose',   5),
  ('Grants',      'teal',   6),
  ('Fundraising', 'orange', 7),
  ('Partners',    'pink',   8);

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
  -- People you correspond with through this mailbox join this project
  -- (e.g. the ADAR mailbox → ADAR).
  default_project_id      uuid references projects (id) on delete set null,
  -- OAuth tokens, AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY.
  refresh_token_enc       text,
  access_token_enc        text,
  access_token_expires_at timestamptz,

  -- Incremental sync (Gmail history API + Pub/Sub push).
  history_id              bigint,          -- last processed mailbox historyId (only moves forward)
  last_synced_at          timestamptz,
  sync_locked_until       timestamptz,     -- lease lock: one incremental run at a time
  sync_requested          boolean not null default false, -- a push arrived while locked
  watch_expires_at        timestamptz,     -- users.watch expiration
  watch_renewed_at        timestamptz,

  -- Initial historical import (also reused to re-list a gap after the
  -- history id expired).
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

-- Every address that is "me".
create view self_addresses as
  select lower(email) as email from gmail_accounts
  union
  select lower(unnest(aliases)) from gmail_accounts;

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  -- venue = concert hall, chamber music hall, theater, festival, club…
  kind        text check (kind in ('venue', 'funder', 'partner', 'press', 'agency', 'institution', 'other')),
  city        text,
  -- Email domains owned by the organization (lowercase, e.g. {'moma.org'}).
  -- New contacts with a matching address are linked automatically, and the
  -- organization's correspondence includes anyone at these domains.
  domains     text[] not null default '{}',
  website     text,
  notes       text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index organizations_name_key on organizations (lower(name));
create index organizations_kind_idx on organizations (kind);
create index organizations_domains_idx on organizations using gin (domains);
create trigger organizations_updated_at before update on organizations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table contacts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text,
  organization_id       uuid references organizations (id) on delete set null,
  role                  text,
  notes                 text,
  tags                  text[] not null default '{}',
  -- new = auto-created from Gmail and not reviewed yet; archived = hidden noise.
  status                text not null default 'new'
                          check (status in ('new', 'lead', 'active', 'inactive', 'archived')),
  follow_up_at          date,
  follow_up_note        text,
  source                text not null default 'manual' check (source in ('manual', 'gmail')),

  -- Denormalized from the email history by refresh_contact_stats().
  last_contacted_at     timestamptz,   -- latest direct exchange either way
  last_inbound_at       timestamptz,   -- latest message *from* them
  last_outbound_at      timestamptz,   -- latest message from me *to* them (To:)
  -- My latest email to them (To:) in a thread where nobody has answered since.
  awaiting_reply_since  timestamptz,
  message_count         integer not null default 0,
  -- "Mark done" on needs-reply / awaiting-reply lists: hidden until newer mail.
  reply_dismissed_at    timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
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
                check (email = lower(email) and position('@' in email) > 1 and email !~ '\s'),
  contact_id  uuid not null references contacts (id) on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index contact_emails_contact_idx on contact_emails (contact_id);
create unique index contact_emails_one_primary on contact_emails (contact_id) where is_primary;

-- My own addresses can never belong to a contact.
create or replace function contact_emails_not_self() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from self_addresses where email = new.email) then
    raise exception '% is one of your own addresses', new.email using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger contact_emails_not_self before insert or update of email on contact_emails
  for each row execute function contact_emails_not_self();

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
  -- Plain-text body with quoted replies stripped, capped in length
  -- (short for automated mail).
  body_text           text,
  sent_at             timestamptz not null,
  label_ids           text[] not null default '{}',
  -- Newsletters, notifications, receipts... Only used for contact
  -- auto-creation, stats and default filtering — the mail is still stored.
  is_automated        boolean not null default false,
  -- list_id | precedence | auto_submitted | unsubscribe | category | noreply
  automated_reason    text,
  has_attachments     boolean not null default false,
  attachments         jsonb not null default '[]',  -- [{filename, mimeType, size}]
  created_at          timestamptz not null default now(),
  unique (account_id, gmail_message_id)
);
create index messages_sent_at_idx on messages (sent_at desc);
create index messages_thread_idx on messages (account_id, gmail_thread_id, sent_at);
create index messages_rfc822_idx on messages (rfc822_message_id);
-- Mail client views (Inbox, Starred, Sent, unread…) filter on current labels.
create index messages_labels_idx on messages using gin (label_ids);

-- Full-text search vector, computed on the fly (an index on the expression is
-- far smaller than a stored column). Queries must use exactly this call:
--   message_search_vector(subject, from_name, from_email, coalesce(body_text, snippet))
create or replace function message_search_vector(subject text, from_name text, from_email text, body text)
returns tsvector
language sql immutable parallel safe as $$
  select setweight(to_tsvector('english', coalesce(subject, '')), 'A')
      || setweight(to_tsvector('simple', coalesce(from_name, '') || ' ' || coalesce(from_email, '')), 'B')
      || setweight(to_tsvector('english', left(coalesce(body, ''), 20000)), 'C')
$$;
create index messages_search_idx on messages
  using gin (message_search_vector(subject, from_name, from_email, coalesce(body_text, snippet)));

-- The tsquery for user input: English stemming, plus exact words so names
-- and stopword-like words ("Will") still match.
create or replace function message_search_query(q text)
returns tsquery
language sql immutable parallel safe as $$
  select websearch_to_tsquery('english', q) || websearch_to_tsquery('simple', q)
$$;

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
  -- booking (a concert/show at a venue), fundraising (private donors),
  -- partnership, grant, press, sale, other. Stage labels adapt to the kind.
  kind             text not null default 'other'
                     check (kind in ('booking', 'fundraising', 'partnership', 'grant', 'press', 'sale', 'other')),
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
create index opportunities_kind_idx on opportunities (kind);
create index opportunities_contact_idx on opportunities (contact_id);
create index opportunities_organization_idx on opportunities (organization_id);
create index opportunities_project_idx on opportunities (project_id);
create index opportunities_follow_up_idx on opportunities (follow_up_at) where follow_up_at is not null;
create trigger opportunities_updated_at before update on opportunities
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Outgoing email approval queue
--
-- Claude (assistant or autopilot) proposes emails; each proposal is also saved
-- as a real Gmail draft. The owner approves (→ sent through Gmail), edits,
-- asks Claude to revise it with a note, or discards it. Nothing is sent
-- without the owner's approval.
-- ---------------------------------------------------------------------------
create table email_drafts (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references gmail_accounts (id) on delete cascade,
  contact_id           uuid references contacts (id) on delete set null,
  opportunity_id       uuid references opportunities (id) on delete set null,
  -- Reply in this message's thread (messages.id) when set.
  reply_to_message_id  uuid references messages (id) on delete set null,
  purpose              text not null default 'follow_up'
                         check (purpose in ('reply', 'follow_up', 'nudge', 'outreach', 'other')),
  origin               text not null default 'assistant' check (origin in ('assistant', 'autopilot', 'owner')),
  status               text not null default 'proposed'
                         check (status in ('proposed', 'revising', 'sending', 'sent', 'discarded', 'failed')),
  to_emails            text[] not null default '{}',
  cc_emails            text[] not null default '{}',
  subject              text not null default '',
  body_text            text not null default '',
  -- One sentence from Claude: why this email, why now.
  rationale            text,
  -- Owner notes and previous versions: [{at, note, subject, body}]
  revisions            jsonb not null default '[]',
  gmail_draft_id       text,
  gmail_thread_id      text,
  sent_gmail_message_id text,
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  sent_at              timestamptz
);
create index email_drafts_status_idx on email_drafts (status, created_at desc);
create index email_drafts_contact_idx on email_drafts (contact_id);
-- The autopilot never stacks two open proposals for the same person.
create unique index email_drafts_one_open_autopilot on email_drafts (contact_id)
  where origin = 'autopilot' and status in ('proposed', 'revising');
create trigger email_drafts_updated_at before update on email_drafts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Small key/value settings edited in the app (autopilot, signature, …)
-- ---------------------------------------------------------------------------
create table app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Login throttling (per client IP and a global bucket)
-- ---------------------------------------------------------------------------
create table login_attempts (
  bucket        text primary key,
  failures      integer not null default 0,
  window_start  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Recompute the denormalized history columns for the given contacts.
-- Call after inserting/deleting messages, and after moving addresses.
--
-- Only direct exchanges count: mail from them (From, or Reply-To for contact
-- forms) and mail from me with them in To. Being cc'd on someone else's thread
-- does not make someone "last contacted" or "awaiting a reply".
--
-- Automated-looking mail counts as real correspondence only when it came from
-- a marketing tool or was categorized by Gmail (reason unsubscribe/category)
-- AND I also wrote in that thread (a reply sent through HubSpot, say). Mailing
-- lists, bulk mail and auto-replies never count.
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
  )
  update contacts c
     set last_contacted_at    = greatest(s.in_at, s.out_any_at),
         last_inbound_at      = s.in_at,
         last_outbound_at     = s.out_at,
         awaiting_reply_since = s.awaiting_at,
         message_count        = coalesce(s.cnt, 0)
    from ids
    left join stats s on s.contact_id = ids.contact_id
   where c.id = ids.contact_id
     and (c.last_contacted_at, c.last_inbound_at, c.last_outbound_at, c.awaiting_reply_since, c.message_count)
         is distinct from (greatest(s.in_at, s.out_any_at), s.in_at, s.out_at, s.awaiting_at, coalesce(s.cnt, 0));
end $$;

-- Merge p_source into p_target: addresses, projects and opportunities move to
-- the target, empty target fields are filled from the source, tags are unioned,
-- notes are concatenated, and the source contact is deleted.
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

  update contacts c
     set name            = coalesce(nullif(btrim(t.name), ''), s.name),
         organization_id = coalesce(t.organization_id, s.organization_id),
         role            = coalesce(nullif(btrim(t.role), ''), s.role),
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
alter table login_attempts       enable row level security;
alter table email_drafts         enable row level security;
alter table app_settings         enable row level security;

revoke execute on function refresh_contact_stats(uuid[]) from public;
revoke execute on function merge_contacts(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke execute on all functions in schema public from anon, authenticated';
    -- Objects created later in this schema must not be exposed either.
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from anon, authenticated, public';
  end if;
end $$;
