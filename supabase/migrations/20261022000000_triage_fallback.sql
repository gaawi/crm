-- Triage decisions the rules made only because Claude was off ('fallback')
-- are reviewed by Claude once it is configured (lib/mail/triage.ts).
alter table message_triage drop constraint if exists message_triage_decided_by_check;
alter table message_triage add constraint message_triage_decided_by_check
  check (decided_by in ('pending', 'rule', 'fallback', 'claude', 'owner'));
