-- ============================================================================
-- Smart inbox. Each new email in an inbox gets a triage decision: important
-- (stays in Vela's Inbox) or not (goes to "Other": promotions, newsletters,
-- notifications), with a category, whether it needs a reply, and why. Rules
-- decide the obvious cases, Claude the rest; the owner can correct a decision
-- and Vela then remembers the sender. Important emails that need a reply get a
-- reply drafted automatically (an Approvals proposal; never sent on its own).
-- Kept in its own table so classifying never rewrites the large messages rows.
-- ============================================================================

create table if not exists message_triage (
  message_id uuid primary key references messages (id) on delete cascade,
  account_id uuid not null references gmail_accounts (id) on delete cascade,
  -- null while being classified (decided_by = 'pending')
  important boolean,
  category text,
  needs_reply boolean not null default false,
  reason text,
  decided_by text not null default 'pending' check (decided_by in ('pending', 'rule', 'claude', 'owner')),
  claimed_at timestamptz not null default now(),
  decided_at timestamptz,
  -- automatic reply draft
  reply_status text check (reply_status in ('drafting', 'drafted', 'skipped', 'failed')),
  reply_started_at timestamptz,
  reply_attempts int not null default 0,
  reply_draft_id uuid references email_drafts (id) on delete set null,
  reply_note text
);

create index if not exists message_triage_reply_due_idx on message_triage (decided_at)
  where important and needs_reply and (reply_status is null or reply_status in ('drafting', 'failed'));

-- Senders the owner corrected: their next emails follow the owner's choice.
create table if not exists triage_senders (
  email text primary key,
  important boolean not null,
  updated_at timestamptz not null default now()
);

-- "Reply ready" on a conversation in the mail list.
create index if not exists email_drafts_thread_idx on email_drafts (account_id, gmail_thread_id);
