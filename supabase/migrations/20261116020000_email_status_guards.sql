-- The email-derived statuses can't be changed by hand (the app, ChatGPT or SQL):
-- only the automatic functions below change them (they set crm.auto = on for
-- their own transaction). A manual change is silently undone.

-- 1. Stage: To contact / Contacted / Replied always follow the emails.
--    A manual change between them (or back from a hand-set stage) is replaced by
--    the stage the emails give (never below Contacted for a row we already
--    marked Contacted from the old lists, so it can't be written to again as new).
create or replace function opportunities_email_stage_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target text;
  ord text[] := array['lead', 'contacted', 'replied'];
begin
  if new.stage in ('lead', 'contacted', 'replied') then
    target := crm_email_stage(new.contact_id, new.organization_id);
    if tg_op = 'UPDATE' and old.stage in ('lead', 'contacted', 'replied')
       and array_position(ord, old.stage) > array_position(ord, target) then
      target := old.stage;  -- keep what we had (old lists), never go down
    end if;
    if tg_op = 'INSERT' and array_position(ord, new.stage) > array_position(ord, target) then
      target := new.stage;  -- an imported row may already be Contacted
    end if;
    new.stage := target;
  end if;
  return new;
end;
$$;

-- 2. Bounces and automatic replies: only the detectors set them.
create or replace function crm_guard_auto_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('crm.auto', true), '') <> 'on' then
    if tg_table_name = 'contact_emails' then
      new.bounced_at := old.bounced_at;
      new.bounce_detail := old.bounce_detail;
    elsif tg_table_name = 'messages' then
      new.auto_reply := old.auto_reply;
    elsif tg_table_name = 'contacts' then
      new.last_auto_reply_at := old.last_auto_reply_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contact_emails_guard_auto on contact_emails;
create trigger contact_emails_guard_auto before update of bounced_at, bounce_detail on contact_emails
  for each row execute function crm_guard_auto_columns();
drop trigger if exists messages_guard_auto on messages;
create trigger messages_guard_auto before update of auto_reply on messages
  for each row execute function crm_guard_auto_columns();
drop trigger if exists contacts_guard_auto on contacts;
create trigger contacts_guard_auto before update of last_auto_reply_at on contacts
  for each row execute function crm_guard_auto_columns();

-- The detectors open the gate for their own transaction.
create or replace function crm_apply_bounce(p_message uuid) returns integer
language plpgsql set search_path = public as $$
declare
  m record;
  n integer := 0;
begin
  select id, account_id, sent_at, from_email, subject, coalesce(body_text, '') || ' ' || coalesce(snippet, '') as txt into m
    from messages where id = p_message;
  if m.id is null or not crm_is_bounce(m.from_email, m.subject) then return 0; end if;
  perform set_config('crm.auto', 'on', true);
  update contact_emails ce
     set bounced_at = m.sent_at,
         bounce_detail = left(regexp_replace(m.txt, '\s+', ' ', 'g'), 300)
   where ce.bounced_at is null
     and position(lower(ce.email) in lower(m.txt)) > 0
     and exists (select 1 from message_participants mp join messages o on o.id = mp.message_id
                  where lower(mp.email) = lower(ce.email) and o.direction = 'outbound'
                    and o.sent_at <= m.sent_at and o.sent_at > m.sent_at - interval '14 days');
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function messages_bounce_auto_trigger() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.direction = 'inbound' then
    if crm_is_auto_reply(new.subject, new.automated_reason) and not crm_is_bounce(new.from_email, new.subject) then
      perform set_config('crm.auto', 'on', true);
      update messages set auto_reply = true where id = new.id and not auto_reply;
    end if;
    perform crm_apply_bounce(new.id);
  end if;
  return null;
end;
$$;

create or replace function message_participants_auto_reply_trigger() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role = 'from' then
    perform set_config('crm.auto', 'on', true);
    update contacts c set last_auto_reply_at = greatest(c.last_auto_reply_at, m.sent_at)
      from messages m, contact_emails ce
     where m.id = new.message_id and m.auto_reply and ce.email = new.email and c.id = ce.contact_id;
  end if;
  return null;
end;
$$;

comment on column opportunities.stage is
  'lead (To contact), contacted, replied, proposal (Offer sent), negotiation (In conversation), won (Confirmed), lost (Declined). lead/contacted/replied are computed from the emails by triggers and cannot be set by hand: any manual change between them is undone. ChatGPT: never set lead/contacted/replied; set proposal/negotiation/won/lost only when the owner decides.';
