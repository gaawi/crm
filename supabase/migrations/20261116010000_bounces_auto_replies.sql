-- Bounces and automatic replies, so the sheet can tell them apart from real answers.
-- (Neither counts as an answer already: they are automated messages.)
--   contact_emails.bounced_at: a "delivery failed" notice named this address after we wrote to it.
--   messages.auto_reply: an out-of-office / automatic reply.

alter table contact_emails add column if not exists bounced_at timestamptz;
alter table contact_emails add column if not exists bounce_detail text;
alter table messages add column if not exists auto_reply boolean not null default false;

comment on column contact_emails.bounced_at is
  'When a delivery-failure notice (mailer-daemon / postmaster) said this address does not work, after we wrote to it. Set automatically (trigger messages_bounce_check). ChatGPT: a bounced address needs a new, verified email for that person; add it to contact_emails and make it is_primary.';
comment on column contact_emails.bounce_detail is 'First lines of the delivery-failure notice.';
comment on column messages.auto_reply is 'Out-of-office or other automatic reply (not a real answer). Set automatically.';

create or replace function crm_is_bounce(p_from text, p_subject text) returns boolean
language sql immutable as $$
  select coalesce(p_from, '') ~* '(mailer-daemon|postmaster|mail-daemon)'
     and coalesce(p_subject, '') ~* '(delivery status notification|undeliver|not delivered|mail delivery (failed|subsystem)|returned mail|delivery (has )?failed|failure notice|delivery failure)'
$$;

create or replace function crm_is_auto_reply(p_subject text, p_reason text) returns boolean
language sql immutable as $$
  select coalesce(p_subject, '') ~* '(out of (the )?office|automatic reply|auto.?reply|autoreply|auto-response|away from (my|the) (desk|office)|on vacation|respuesta autom|fuera de la oficina|automatische antwort|abwesenheitsnotiz|autosvar|automaattinen vastaus|r[eé]ponse automatique|risposta automatica)'
      or (coalesce(p_reason, '') = 'auto_submitted' and coalesce(p_subject, '') ~* '^(automatic|auto)')
$$;

-- Marks the addresses named in a bounce we received after writing to them.
create or replace function crm_apply_bounce(p_message uuid) returns integer
language plpgsql set search_path = public as $$
declare
  m record;
  n integer := 0;
begin
  select id, account_id, sent_at, from_email, subject, coalesce(body_text, '') || ' ' || coalesce(snippet, '') as txt into m
    from messages where id = p_message;
  if m.id is null or not crm_is_bounce(m.from_email, m.subject) then return 0; end if;
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
      update messages set auto_reply = true where id = new.id and not auto_reply;
    end if;
    perform crm_apply_bounce(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists messages_bounce_check on messages;
create trigger messages_bounce_check after insert on messages
  for each row execute function messages_bounce_auto_trigger();

-- Backfill.
update messages set auto_reply = false where auto_reply;
update messages set auto_reply = true
 where direction = 'inbound' and not auto_reply
   and crm_is_auto_reply(subject, automated_reason) and not crm_is_bounce(from_email, subject);
select crm_apply_bounce(id) from messages where direction = 'inbound' and crm_is_bounce(from_email, subject);

-- The latest automatic reply from each contact, kept on the contact (cheap for the sheet).
alter table contacts add column if not exists last_auto_reply_at timestamptz;
comment on column contacts.last_auto_reply_at is 'Latest out-of-office / automatic reply from this contact (not a real answer). Set automatically.';

create or replace function message_participants_auto_reply_trigger() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role = 'from' then
    update contacts c set last_auto_reply_at = greatest(c.last_auto_reply_at, m.sent_at)
      from messages m, contact_emails ce
     where m.id = new.message_id and m.auto_reply and ce.email = new.email and c.id = ce.contact_id;
  end if;
  return null;
end;
$$;

drop trigger if exists message_participants_auto_reply on message_participants;
create trigger message_participants_auto_reply after insert on message_participants
  for each row execute function message_participants_auto_reply_trigger();

update contacts c set last_auto_reply_at = x.at
  from (select ce.contact_id, max(m.sent_at) at from messages m join message_participants mp on mp.message_id = m.id and mp.role = 'from'
          join contact_emails ce on ce.email = mp.email where m.auto_reply group by 1) x
 where x.contact_id = c.id;
