-- Merge found venues, images and artists into a profile: existing entries stay, missing details are filled, new ones are added (within the profile limits).
create or replace function crm_merge_profile(p_org uuid, p_venues jsonb, p_images jsonb, p_artists jsonb) returns void
language plpgsql set search_path = public as $$
declare prof jsonb; v jsonb; cur jsonb; i int; found boolean;
begin
  select coalesce(profile, '{}'::jsonb) into prof from organizations where id = p_org;
  if prof is null or prof = '{}'::jsonb then return; end if;
  cur := case when jsonb_typeof(prof->'venues') = 'array' then prof->'venues' else '[]'::jsonb end;
  for v in select * from jsonb_array_elements(p_venues) loop
    found := false;
    for i in 0 .. jsonb_array_length(cur) - 1 loop
      if lower(cur->i->>'name') = lower(v->>'name') then
        cur := jsonb_set(cur, array[i::text], v || (cur->i));
        found := true; exit;
      end if;
    end loop;
    if not found and jsonb_array_length(cur) < 20 then cur := cur || jsonb_build_array(v); end if;
  end loop;
  prof := jsonb_set(prof, '{venues}', cur);
  cur := case when jsonb_typeof(prof->'images') = 'array' then prof->'images' else '[]'::jsonb end;
  for v in select * from jsonb_array_elements(p_images) loop
    if jsonb_array_length(cur) < 8 and not exists (select 1 from jsonb_array_elements(cur) x where x->>'url' = v->>'url') then
      cur := cur || jsonb_build_array(v);
    end if;
  end loop;
  prof := jsonb_set(prof, '{images}', cur);
  cur := case when jsonb_typeof(prof->'artists') = 'array' then prof->'artists' else '[]'::jsonb end;
  for v in select * from jsonb_array_elements(p_artists) loop
    if jsonb_array_length(cur) < 40 and not exists (select 1 from jsonb_array_elements(cur) x where lower(x->>'name') = lower(v->>'name')) then
      cur := cur || jsonb_build_array(v);
    end if;
  end loop;
  prof := jsonb_set(prof, '{artists}', cur);
  update organizations set profile = prof, profile_updated_at = now() where id = p_org;
end;
$$;
