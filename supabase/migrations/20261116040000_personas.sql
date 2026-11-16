-- "I am Guillermo / Josefina" (lib/persona.ts): Josefina's Gmail accounts.
-- Every other account is Guillermo's. Today and Approvals show each person
-- only their own accounts' emails and mass mailings, and the follow-ups of the
-- booking sheets that send from them (projects.send_account_id).
insert into app_settings (key, value)
values ('personas', '{"josefina": ["josefinaupd@gmail.com"]}'::jsonb)
on conflict (key) do nothing;

comment on column projects.send_account_id is
  'The Gmail account this booking sheet sends from. It also decides whose sheet it is on Today / Approvals: Josefina''s accounts (app_settings personas) make it hers, any other account (or none) Guillermo''s. Josefina''s own sheet: "Booking · Josefina".';
