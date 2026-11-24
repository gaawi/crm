-- "Replied" means they answered OUR outreach, not any email ever exchanged
-- with someone at the organization (a rental inquiry from 2019, a composer
-- thanking us for a premiere...). A sheet can set projects.replies_since:
-- then a row is Replied only when someone from the organization wrote after
-- our first email to them on or after that date. Null keeps the old rule
-- (any answer, any time). Booking USA counts from 1 Sep 2026.

alter table projects add column if not exists replies_since timestamptz;
comment on column projects.replies_since is
  'Campaign sheets: a row counts as Replied only when the organization answered after our first email sent on or after this date. Null = any answer at any time counts.';

update projects set replies_since = '2026-09-01' where id = 'f195d409-8cb8-4471-9bd3-516ef779c3e5';

drop function if exists crm_email_stage(uuid, uuid);

create or replace function crm_email_stage(p_contact uuid, p_org uuid, p_project uuid default null)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  since timestamptz;
  wrote boolean;
  first_out timestamptz;
  last_in timestamptz;
begin
  select replies_since into since from projects where id = p_project;

  select bool_or(k.last_outbound_at is not null), max(k.last_inbound_at)
    into wrote, last_in
    from contacts k
   where k.id = p_contact or (p_org is not null and k.organization_id = p_org);

  if not coalesce(wrote, false) then
    return 'lead';
  end if;
  if since is null then
    return case when last_in is not null then 'replied' else 'contacted' end;
  end if;

  -- Our first email to anyone there since the sheet's start.
  select min(m.sent_at) into first_out
    from contacts k
    join contact_emails ce on ce.contact_id = k.id
    join message_participants mp on mp.email = ce.email and mp.role in ('to', 'cc')
    join messages m on m.id = mp.message_id and m.direction = 'outbound'
   where (k.id = p_contact or (p_org is not null and k.organization_id = p_org))
     and m.sent_at >= since;

  return case when first_out is not null and last_in > first_out then 'replied' else 'contacted' end;
end;
$$;

create or replace function crm_sync_email_stage(p_contact uuid, p_org uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  with t as (
    select op.id, crm_email_stage(op.contact_id, op.organization_id, op.project_id) as target, op.stage
      from opportunities op
     where op.stage in ('lead', 'contacted', 'replied')
       and (op.contact_id = p_contact or (p_org is not null and op.organization_id = p_org))
  )
  update opportunities op
     set stage = t.target, updated_at = now()
    from t
   where op.id = t.id
     and array_position(array['lead', 'contacted', 'replied'], t.target) > array_position(array['lead', 'contacted', 'replied'], t.stage);
  get diagnostics n = row_count;
  return n;
end;
$$;

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
    target := crm_email_stage(new.contact_id, new.organization_id, new.project_id);
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

-- One time: Booking USA rows that were Replied only because of old or
-- unrelated emails go back to what the new rule says (rows with an answer
-- set by hand stay). The email-stage trigger never moves a row down, so it
-- is paused for this update only.
alter table opportunities disable trigger opportunities_email_stage;
update opportunities op
   set stage = t.target,
       updated_at = now(),
       notes_history = concat_ws(E'\n\n', nullif(op.notes_history, ''),
         '2026-11-24: estaba en Replied por emails antiguos o de otro tema; Replied ahora solo cuenta respuestas a nuestros emails de booking desde el 1/9/2026.')
  from (select id, crm_email_stage(contact_id, organization_id, project_id) as target
          from opportunities
         where project_id = 'f195d409-8cb8-4471-9bd3-516ef779c3e5' and stage = 'replied' and response is null) t
 where op.id = t.id and t.target <> 'replied';
alter table opportunities enable trigger opportunities_email_stage;
