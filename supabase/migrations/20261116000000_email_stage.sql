-- The first stages of a row are set automatically from the emails, never by hand:
--   lead (To contact): we never wrote;
--   contacted: we wrote and nobody from the organization ever answered;
--   replied: someone from the organization answered at least once.
-- Only upgrades (lead -> contacted -> replied); rows in a hand-set stage
-- (proposal, negotiation, won, lost) are never touched. Contacts of the same
-- organization count (we wrote to info@, the director answered).

alter table opportunities drop constraint if exists opportunities_stage_check;
alter table opportunities add constraint opportunities_stage_check
  check (stage in ('lead', 'contacted', 'replied', 'proposal', 'negotiation', 'won', 'lost'));

create or replace function crm_email_stage(p_contact uuid, p_org uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when bool_or(k.last_outbound_at is not null) and bool_or(k.last_inbound_at is not null) then 'replied'
    when bool_or(k.last_outbound_at is not null) then 'contacted'
    else 'lead'
  end
  from contacts k
  where k.id = p_contact or (p_org is not null and k.organization_id = p_org)
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
    select op.id, crm_email_stage(op.contact_id, op.organization_id) as target, op.stage
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

create or replace function contacts_email_stage_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform crm_sync_email_stage(new.id, new.organization_id);
  return null;
end;
$$;

drop trigger if exists contacts_email_stage on contacts;
create trigger contacts_email_stage
  after insert or update of last_inbound_at, last_outbound_at, organization_id on contacts
  for each row execute function contacts_email_stage_trigger();

-- A row that gets a contact or organization picks up its email stage too.
create or replace function opportunities_email_stage_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target text;
begin
  if new.stage in ('lead', 'contacted', 'replied') then
    target := crm_email_stage(new.contact_id, new.organization_id);
    if array_position(array['lead', 'contacted', 'replied'], target) > array_position(array['lead', 'contacted', 'replied'], new.stage) then
      new.stage := target;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_email_stage on opportunities;
create trigger opportunities_email_stage
  before insert or update of stage, contact_id, organization_id on opportunities
  for each row execute function opportunities_email_stage_trigger();

comment on column opportunities.stage is
  'lead (To contact), contacted, replied, proposal (Offer sent), negotiation (In conversation), won (Confirmed), lost (Declined). lead/contacted/replied are set automatically from the emails (triggers contacts_email_stage, opportunities_email_stage): only upgrades, never by hand. ChatGPT: do not set lead/contacted/replied yourself; set proposal/negotiation/won/lost only when the owner decides.';
