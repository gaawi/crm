-- ============================================================================
-- Monitor-only Gmail accounts.
--
-- A mailbox someone else uses (e.g. a partner who also does booking) can be
-- connected only to watch it: its email is imported and shows in contacts,
-- history, search and Today, but Vela never changes anything in it — no
-- read/unread, archive, labels, trash, drafts or sending
-- (lib/gmail/client.ts refuses every write for it). It is left out of All
-- Inboxes and of every "send from" choice.
--
-- Idempotent: safe to run twice.
-- ============================================================================

alter table gmail_accounts add column if not exists monitor_only boolean not null default false;
