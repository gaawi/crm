-- Saves the person who decides (books the artists / plans the season) for a
-- campaign row, found in public official sources: creates or reuses the
-- contact, adds the public email, puts them in the campaign's project and,
-- when it is safe, makes them the row's contact so the campaign writes to
-- them instead of a president, a board member or info@.
--
-- Safe means: the decider has an email, and the row's current contact has
-- never corresponded with us (no email in or out) and has no open draft for
-- the row. Otherwise the row is left as it is and the result says why.
-- The previous contact is never deleted; the row's notes record the change.
create or replace function crm_add_decider_contact(p_rows jsonb, p_by text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r jsonb;
  opp record;
  cur record;
  v_email text;
  v_contact uuid;
  created int := 0;
  reused int := 0;
  switched int := 0;
  kept jsonb := '[]'::jsonb;
  open_draft boolean;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    select o.id, o.organization_id, o.contact_id, o.project_id, o.notes into opp
      from opportunities o where o.id = (r->>'opportunity')::uuid;
    if opp.id is null or coalesce(btrim(r->>'name'), '') = '' then
      kept := kept || jsonb_build_object('opportunity', r->>'opportunity', 'why', 'row or name missing');
      continue;
    end if;
    v_email := nullif(lower(btrim(coalesce(r->>'email', ''))), '');
    if v_email is not null and (position('@' in v_email) < 2 or v_email ~ '\s') then
      v_email := null;
    end if;

    -- Reuse: same email anywhere, else same first + last name in the organization.
    v_contact := null;
    if v_email is not null then
      select contact_id into v_contact from contact_emails where email = v_email;
    end if;
    if v_contact is null then
      select k.id into v_contact from contacts k
       where k.organization_id = opp.organization_id and k.status <> 'archived'
         and lower(split_part(regexp_replace(btrim(k.name), '^(dr|mr|mrs|ms|prof)\.?\s+', '', 'i'), ' ', 1))
             = lower(split_part(regexp_replace(btrim(r->>'name'), '^(dr|mr|mrs|ms|prof)\.?\s+', '', 'i'), ' ', 1))
         and lower(regexp_replace(btrim(k.name), '^.*\s', '')) = lower(regexp_replace(btrim(r->>'name'), '^.*\s', ''))
       limit 1;
    end if;

    if v_contact is null then
      insert into contacts (name, organization_id, role, status, source, notes, tags, research_sources, researched_at)
      values (left(btrim(r->>'name'), 200), opp.organization_id, left(r->>'role', 200), 'lead', 'manual',
              r->>'note',
              array['booking-research-2026', 'decision-maker'],
              (select coalesce(array_agg(s), '{}') from (select jsonb_array_elements_text(coalesce(r->'sources', '[]'::jsonb)) s limit 20) z),
              now())
      returning id into v_contact;
      created := created + 1;
    else
      update contacts k set
        role = coalesce(nullif(k.role, ''), left(r->>'role', 200)),
        notes = case when coalesce(btrim(k.notes), '') = '' then r->>'note' else k.notes || E'\n\n' || (r->>'note') end,
        tags = array(select distinct t from unnest(k.tags || array['decision-maker']) t),
        research_sources = (select coalesce(array_agg(s), '{}') from (select distinct s from unnest(k.research_sources
                              || array(select jsonb_array_elements_text(coalesce(r->'sources', '[]'::jsonb)))) s limit 20) z),
        updated_at = now()
      where k.id = v_contact;
      reused := reused + 1;
    end if;

    if v_email is not null and not exists (select 1 from contact_emails where email = v_email) then
      insert into contact_emails (email, contact_id, is_primary)
      values (v_email, v_contact, not exists (select 1 from contact_emails where contact_id = v_contact and is_primary));
    end if;

    if opp.project_id is not null then
      insert into contact_projects (contact_id, project_id) values (v_contact, opp.project_id) on conflict do nothing;
    end if;

    -- The profile's pitchTo gets the email, so the app flags the person as "Decides".
    if v_email is not null then
      update organizations o set profile = jsonb_set(o.profile, '{booking,pitchTo,email}', to_jsonb(v_email))
       where o.id = opp.organization_id and o.profile->'booking'->'pitchTo' ? 'name'
         and lower(o.profile->'booking'->'pitchTo'->>'name') = lower(btrim(r->>'name'));
    end if;

    if opp.contact_id = v_contact then
      continue;
    end if;
    select k.id, k.name, k.last_inbound_at, k.last_outbound_at into cur from contacts k where k.id = opp.contact_id;
    select exists (select 1 from email_drafts d where d.opportunity_id = opp.id and d.status not in ('sent', 'discarded')) into open_draft;
    if not exists (select 1 from contact_emails where contact_id = v_contact) then
      kept := kept || jsonb_build_object('opportunity', opp.id, 'why', 'decider has no email');
    elsif cur.id is not null and (cur.last_inbound_at is not null or cur.last_outbound_at is not null) then
      kept := kept || jsonb_build_object('opportunity', opp.id, 'why', 'current contact has correspondence');
    elsif open_draft then
      kept := kept || jsonb_build_object('opportunity', opp.id, 'why', 'open draft for the row');
    else
      update opportunities set
        contact_id = v_contact,
        notes = concat_ws(E'\n', nullif(notes, ''),
                  to_char(now(), 'YYYY-MM-DD') || ': contact set to the decider ' || btrim(r->>'name')
                  || coalesce(' (was ' || cur.name || ')', '') || ', public research by ' || p_by || '.'),
        updated_at = now()
      where id = opp.id;
      switched := switched + 1;
    end if;
  end loop;
  return jsonb_build_object('created', created, 'reused', reused, 'rows_switched', switched, 'rows_kept', kept);
end;
$$;

revoke all on function crm_add_decider_contact(jsonb, text) from public, anon, authenticated;
grant execute on function crm_add_decider_contact(jsonb, text) to service_role;

comment on function crm_add_decider_contact(jsonb, text) is
  'Rows [{opportunity, name, role, email, sources[], note}]: creates or reuses the decider contact (tag decision-maker), adds the public email, adds them to the row''s project, sets booking.pitchTo.email, and makes them the row contact only when the current contact never corresponded and no draft is open. Never deletes. Not callable from the public API.';
