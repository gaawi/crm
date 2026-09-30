-- Optional hardening for Claude's read-only SQL tool (query_database).
-- Creates a login role that can only SELECT CRM data (no OAuth tokens), then
-- set DATABASE_READONLY_URL to a connection string for this role, e.g.
--   postgresql://crm_reader.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
-- Replace CHANGE_ME with a strong password before running.

create role crm_reader login password 'CHANGE_ME' noinherit;
alter role crm_reader set default_transaction_read_only = on;
alter role crm_reader set statement_timeout = '5s';

grant usage on schema public to crm_reader;
grant select on organizations, projects, contacts, contact_emails, contact_projects,
  messages, message_participants, opportunities, email_drafts to crm_reader;
grant select (id, email, display_name, status, last_synced_at, backfill_status, created_at)
  on gmail_accounts to crm_reader;
grant select on self_addresses to crm_reader;
grant execute on function message_search_vector(text, text, text, text), message_search_query(text) to crm_reader;

-- RLS applies to this role (it does not own the tables): allow reads.
do $$
declare t text;
begin
  foreach t in array array['organizations','projects','contacts','contact_emails','contact_projects',
                           'messages','message_participants','opportunities','email_drafts','gmail_accounts']
  loop
    execute format('create policy crm_reader_select on %I for select to crm_reader using (true)', t);
  end loop;
end $$;
