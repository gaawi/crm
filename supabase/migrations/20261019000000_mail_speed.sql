-- ============================================================================
-- Mail speed. The inbox list walked every stored email in date order to find
-- the few in Primary (11 s on 100k emails), and the unread counts per label
-- read every unread email (17k) to find the few hundred with a user label.
-- Partial indexes hold just those rows; the queries repeat the predicates
-- with the same constants so the planner can use them.
-- ============================================================================

create or replace function has_user_label(labels text[]) returns boolean
  language sql immutable parallel safe
  as $$ select exists (select 1 from unnest(labels) l where l like 'Label\_%') $$;

create index if not exists messages_inbox_primary_sent_idx on messages (sent_at desc)
  where label_ids @> '{INBOX}' and not (label_ids && '{CATEGORY_PROMOTIONS,CATEGORY_SOCIAL,CATEGORY_UPDATES,CATEGORY_FORUMS}');

create index if not exists messages_inbox_sent_idx on messages (sent_at desc)
  where label_ids @> '{INBOX}';

create index if not exists messages_unread_user_label_idx on messages (account_id)
  where label_ids @> '{UNREAD}' and has_user_label(label_ids);
