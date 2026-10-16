-- All Inboxes reads each mailbox's newest inbox emails through its own index, so the
-- monitor-only mailboxes (large after the older-history import) are never stepped over.
-- The predicates must stay literal copies of the ones in lib/mail/queries.ts.
create index if not exists messages_inbox_primary_account_sent_idx on messages (account_id, sent_at desc)
  where label_ids @> '{INBOX}' and not (label_ids && '{CATEGORY_PROMOTIONS,CATEGORY_SOCIAL,CATEGORY_UPDATES,CATEGORY_FORUMS}');

create index if not exists messages_inbox_account_sent_idx on messages (account_id, sent_at desc)
  where label_ids @> '{INBOX}';
