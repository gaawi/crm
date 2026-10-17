-- ============================================================================
-- Merge two organizations into one (duplicates from imports: the same presenter
-- under two names, a list entry for an organization already known). The
-- target keeps its fields and gains the source's domains, tags and notes; the
-- source's people, goals / campaign rows and activities move to the target;
-- the source is deleted. Optionally renames the target.
-- ============================================================================

create or replace function merge_organizations(p_target uuid, p_source uuid, p_name text default null)
returns void
language plpgsql as $$
declare
  s organizations%rowtype;
  t organizations%rowtype;
begin
  if p_target = p_source then
    raise exception 'cannot merge an organization into itself';
  end if;
  perform 1 from organizations where id in (p_target, p_source) order by id for update;
  select * into t from organizations where id = p_target;
  if not found then raise exception 'target organization % not found', p_target; end if;
  select * into s from organizations where id = p_source;
  if not found then raise exception 'source organization % not found', p_source; end if;

  update contacts set organization_id = p_target where organization_id = p_source;
  update opportunities set organization_id = p_target where organization_id = p_source;
  update activities set organization_id = p_target where organization_id = p_source;

  delete from organizations where id = p_source;

  update organizations o
     set name     = coalesce(nullif(btrim(p_name), ''), t.name),
         kind     = coalesce(t.kind, s.kind),
         city     = coalesce(nullif(btrim(t.city), ''), s.city),
         website  = coalesce(nullif(btrim(t.website), ''), s.website),
         domains  = array(select distinct x from unnest(t.domains || s.domains) as x order by x),
         tags     = array(select distinct x from unnest(t.tags || s.tags) as x order by x),
         notes    = case
                      when coalesce(btrim(s.notes), '') = '' then t.notes
                      when coalesce(btrim(t.notes), '') = '' then s.notes
                      else t.notes || E'\n\n' || s.notes
                    end,
         profile  = coalesce(t.profile, s.profile),
         profile_updated_at = case when t.profile is null then s.profile_updated_at else t.profile_updated_at end,
         updated_at = now()
   where o.id = p_target;
end;
$$;

revoke execute on function merge_organizations(uuid, uuid, text) from public;
