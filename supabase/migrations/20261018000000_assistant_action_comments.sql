-- ============================================================================
-- Comments on the assistant's suggested actions (calls, WhatsApp, tasks).
--
-- The owner comments on an action ("ya le llamé", "mejor un email",
-- "espera a enero"); the writer routine reads the comments that still wait
-- for an answer, replies and updates or closes the action on its next run.
-- comments: [{ "at": timestamptz, "by": "owner" | "assistant", "text": … }],
-- oldest first. An action waits for the assistant while its last comment is
-- the owner's.
-- ============================================================================

alter table assistant_actions add column if not exists comments jsonb not null default '[]'::jsonb;

create index if not exists assistant_actions_awaiting_reply_idx on assistant_actions (project_id)
  where jsonb_array_length(comments) > 0 and comments -> -1 ->> 'by' = 'owner';
