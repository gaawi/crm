-- Two helpers so ChatGPT (which works straight in the database) can build a
-- campaign without missing a step: a campaign is a project with sheet = true,
-- and each row on it is an opportunity tied to the organization and its
-- contact, with the contact also in contact_projects (that decides the pile
-- their emails go to in Today). Both are safe to run twice.

create or replace function crm_create_campaign(
  p_name text,
  p_currency text default 'USD',
  p_description text default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_currency text := upper(btrim(coalesce(p_currency, 'USD')));
  v_id uuid;
begin
  if v_name = '' then
    raise exception 'crm_create_campaign: give the campaign a name';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    v_currency := 'USD';
  end if;
  select id into v_id from projects where lower(name) = lower(v_name) and sheet and not archived limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into projects (name, description, sheet, currency)
  values (v_name, nullif(btrim(coalesce(p_description, '')), ''), true, v_currency)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function crm_add_campaign_row(
  p_campaign_id uuid,
  p_organization text,
  p_email text default null,
  p_contact_name text default null,
  p_role text default null,
  p_phone text default null,
  p_website text default null,
  p_city text default null,
  p_goal text default 'other',
  p_stage text default 'lead',
  p_notes text default null
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_org_name text := btrim(regexp_replace(coalesce(p_organization, ''), '\s+', ' ', 'g'));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_role text := nullif(btrim(coalesce(p_role, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_domain text;
  v_currency text;
  v_org uuid;
  v_contact uuid;
  v_opp uuid;
begin
  select currency into v_currency from projects where id = p_campaign_id and sheet;
  if v_currency is null then
    raise exception 'crm_add_campaign_row: % is not a campaign (select id, name from projects where sheet and not archived)', p_campaign_id;
  end if;
  if v_org_name = '' then
    raise exception 'crm_add_campaign_row: give the organization name';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'crm_add_campaign_row: invalid email %', p_email;
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{6,16}$' then
    v_phone := null;
  end if;

  -- The organization: found by name (any case) or created.
  select id into v_org from organizations where lower(name) = lower(v_org_name) limit 1;
  if v_org is null then
    insert into organizations (name) values (v_org_name) returning id into v_org;
  end if;
  v_domain := case
    when v_email is null then null
    when split_part(v_email, '@', 2) in ('gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
                                         'icloud.com', 'me.com', 'aol.com', 'msn.com', 'protonmail.com', 'proton.me')
      then null
    else split_part(v_email, '@', 2)
  end;
  update organizations
     set city = coalesce(city, nullif(btrim(coalesce(p_city, '')), '')),
         website = coalesce(website, nullif(btrim(coalesce(p_website, '')), '')),
         domains = case when v_domain is null or v_domain = any(domains) then domains else domains || v_domain end
   where id = v_org;

  -- The contact: found by email (or by name inside the organization) or created.
  if v_email is not null then
    select contact_id into v_contact from contact_emails where email = v_email;
  elsif v_name is not null then
    select id into v_contact from contacts
     where organization_id = v_org and lower(btrim(name)) = lower(v_name)
     order by created_at limit 1;
  end if;
  if v_contact is not null then
    update contacts
       set organization_id = coalesce(organization_id, v_org),
           name = coalesce(nullif(btrim(name), ''), v_name),
           role = coalesce(role, v_role),
           phone = coalesce(phone, v_phone),
           status = case when status = 'new' then 'lead' else status end
     where id = v_contact;
  elsif v_email is not null or v_name is not null or v_phone is not null then
    insert into contacts (name, organization_id, role, phone, status, source)
    values (v_name, v_org, v_role, v_phone, 'lead', 'manual')
    returning id into v_contact;
    if v_email is not null then
      insert into contact_emails (email, contact_id, is_primary) values (v_email, v_contact, true);
    end if;
  end if;

  if v_contact is not null then
    insert into contact_projects (contact_id, project_id) values (v_contact, p_campaign_id) on conflict do nothing;
    perform refresh_contact_stats(array[v_contact]);
  end if;

  -- The row on the campaign: one per organization.
  select id into v_opp from opportunities where project_id = p_campaign_id and organization_id = v_org order by created_at limit 1;
  if v_opp is not null then
    update opportunities set contact_id = coalesce(contact_id, v_contact), updated_at = now() where id = v_opp;
  else
    insert into opportunities (title, kind, stage, contact_id, organization_id, project_id, currency, notes, closed_at)
    values (v_org_name, coalesce(p_goal, 'other'), coalesce(p_stage, 'lead'), v_contact, v_org, p_campaign_id, v_currency,
            nullif(btrim(coalesce(p_notes, '')), ''),
            case when coalesce(p_stage, 'lead') in ('won', 'lost') then now() end)
    returning id into v_opp;
  end if;
  return v_opp;
end;
$$;

-- Not callable through the public API: only the database owner (and ChatGPT's direct connection) runs them.
revoke all on function crm_create_campaign(text, text, text) from public, anon, authenticated;
revoke all on function crm_add_campaign_row(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;

comment on function crm_create_campaign(text, text, text) is
  'ChatGPT: create a campaign (a booking sheet). select crm_create_campaign(''Name · Who'', ''USD''); returns its id. If a campaign with that name already exists, returns that one. Then add each organization with crm_add_campaign_row.';
comment on function crm_add_campaign_row(uuid, text, text, text, text, text, text, text, text, text, text) is
  'ChatGPT: add one organization (and its contact) to a campaign, every link done right: organization, contact, email, the contact in the campaign (contact_projects) and the campaign row (opportunities). Safe to run twice. '
  'Example: select crm_add_campaign_row(p_campaign_id => ''<id>'', p_organization => ''Bunny Hill LIC'', p_email => ''lic@bunnyhillkids.com'', p_contact_name => ''Elizabeth Smith'', p_role => ''Director'', p_stage => ''contacted''); '
  'p_stage: lead (to contact), contacted, proposal, negotiation (in conversation), won, lost. p_goal: other, booking, partnership, education, venue, sponsorship, grant, press... (see opportunities_kind_check). Campaign ids: select id, name from projects where sheet and not archived.';
comment on table projects is
  'Projects and campaigns. A campaign (booking sheet) has sheet = true. ChatGPT: create one with select crm_create_campaign(...) and add organizations with select crm_add_campaign_row(...); do not insert into projects, contacts or opportunities by hand.';
