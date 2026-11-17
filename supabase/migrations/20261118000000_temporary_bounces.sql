-- "Delivery incomplete / temporary problem" notices are not bounces: Gmail keeps
-- trying for up to 2 days and sends a real failure notice if it gives up.
-- Only permanent failures mark an address as bounced.
create or replace function crm_is_temporary_bounce(p_text text) returns boolean
language sql immutable as $$
  select coalesce(p_text, '') ~* '(delivery incomplete|temporary problem delivering|will (retry|try again)|delivery (has been )?delayed|delayed delivery|still trying)'
     and coalesce(p_text, '') !~* '(address not found|does not exist|user unknown|no such user|gave up|permanent(ly)? fail|has been blocked|message blocked)'
$$;

create or replace function crm_apply_bounce(p_message uuid) returns integer
language plpgsql set search_path = public as $$
declare
  m record;
  n integer := 0;
begin
  select id, account_id, sent_at, from_email, subject, coalesce(body_text, '') || ' ' || coalesce(snippet, '') as txt into m
    from messages where id = p_message;
  if m.id is null or not crm_is_bounce(m.from_email, m.subject) then return 0; end if;
  if crm_is_temporary_bounce(left(m.txt, 600)) then return 0; end if;
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

-- Addresses marked from a temporary notice only: no longer bounced.
do $$
begin
  perform set_config('crm.auto', 'on', true);
  update contact_emails set bounced_at = null, bounce_detail = null
   where bounced_at is not null and crm_is_temporary_bounce(bounce_detail);
end $$;
