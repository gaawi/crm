-- Saves one batch of verified public booking research (prepared and checked
-- outside the database: every fact carries its source, images re-checked).
-- Never overwrites: an organization that already has profile.booking and a
-- contact that already has researched_at are left alone; notes are appended,
-- sources, tags and media merged, an existing photo kept.
create or replace function crm_save_booking_research(p_rows jsonb, p_by text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  c jsonb;
  n int;
  orgs int := 0;
  people int := 0;
  photos int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    update organizations o set
      profile = coalesce(o.profile, '{}'::jsonb)
        || jsonb_build_object(
          'booking', r->'booking',
          'sources', (select coalesce(jsonb_agg(distinct s), '[]'::jsonb)
                        from jsonb_array_elements(coalesce(o.profile->'sources', '[]'::jsonb) || coalesce(r->'sources', '[]'::jsonb)) s),
          'media', coalesce(o.profile->'media', '[]'::jsonb)
                   || coalesce((select jsonb_agg(m) from jsonb_array_elements(coalesce(r->'media', '[]'::jsonb)) m
                                 where not exists (select 1 from jsonb_array_elements(coalesce(o.profile->'media', '[]'::jsonb)) x
                                                    where x->>'url' = m->>'url')), '[]'::jsonb),
          'researchedAt', now(),
          'researchedBy', p_by),
      profile_updated_at = now(),
      updated_at = now()
    where o.id = (r->>'org')::uuid and (o.profile is null or not (o.profile ? 'booking'));
    get diagnostics n = row_count;
    orgs := orgs + n;

    for c in select * from jsonb_array_elements(coalesce(r->'contacts', '[]'::jsonb)) loop
      update contacts k set
        notes = case when coalesce(btrim(k.notes), '') = '' then c->>'note' else k.notes || E'\n\n' || (c->>'note') end,
        research_sources = (select coalesce(array_agg(s), '{}')
                              from (select distinct s from unnest(coalesce(k.research_sources, '{}')
                                     || array(select jsonb_array_elements_text(coalesce(c->'sources', '[]'::jsonb)))) s limit 20) z),
        researched_at = now(),
        tags = array(select distinct t from unnest(k.tags || array(select jsonb_array_elements_text(coalesce(r->'tags', '[]'::jsonb)))) t),
        photo_url = coalesce(k.photo_url, c->>'photo_url'),
        photo_source = case when k.photo_url is null and c->>'photo_url' is not null then c->>'photo_source' else k.photo_source end,
        photo_updated_at = case when k.photo_url is null and c->>'photo_url' is not null then now() else k.photo_updated_at end,
        updated_at = now()
      where k.id = (c->>'id')::uuid and k.researched_at is null;
      get diagnostics n = row_count;
      people := people + n;
      if n > 0 and c->>'photo_url' is not null then
        photos := photos + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('organizations', orgs, 'contacts', people, 'portraits', photos);
end;
$$;

revoke all on function crm_save_booking_research(jsonb, text) from public, anon, authenticated;
grant execute on function crm_save_booking_research(jsonb, text) to service_role;

comment on function crm_save_booking_research(jsonb, text) is
  'Saves a batch of verified public booking research into organizations.profile (booking, sources, media) and contacts (notes appended, research_sources, researched_at, tags, photo only when empty). Never overwrites earlier research. Not callable from the public API.';
