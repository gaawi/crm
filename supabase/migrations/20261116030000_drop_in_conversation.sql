-- "In conversation" is no longer used for booking: what a row's emails say
-- (Contacted / Replied) replaces it. A row that leaves a hand-set stage back to
-- the email stages is never put below Contacted (we were already in touch).
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
      target := old.stage;
    end if;
    if tg_op = 'UPDATE' and old.stage in ('proposal', 'negotiation', 'won', 'lost') and target = 'lead' then
      target := 'contacted';
    end if;
    if tg_op = 'INSERT' and array_position(ord, new.stage) > array_position(ord, target) then
      target := new.stage;
    end if;
    new.stage := target;
  end if;
  return new;
end;
$$;

update opportunities set stage = 'lead', updated_at = now(),
  notes_history = concat_ws(E'\n\n', nullif(notes_history, ''), to_char(now(), 'YYYY-MM-DD') || ': estaba en In conversation (ya no se usa); ahora el estado sale de los emails.')
 where stage = 'negotiation'
   and project_id in (select id from projects where name ilike 'Booking USA%');
