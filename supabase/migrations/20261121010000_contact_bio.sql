-- Who the person is, so the owner knows if he is talking to a pianist, an arts administrator or a lawyer.
alter table contacts add column if not exists background text check (background is null or length(background) <= 60);
alter table contacts add column if not exists bio text check (bio is null or length(bio) <= 1200);
alter table contacts add column if not exists bio_source text check (bio_source is null or bio_source ~ '^https://');

comment on column contacts.background is
  'Who the person is, in 1-3 words in Spanish, shown under the name: "Pianista", "Flautista", "Violonchelista", "Gestor cultural", "Abogado", "Profesor de música", "Voluntario jubilado". ChatGPT: fill it from their staff page, LinkedIn or press; find the row by contacts.name and contacts.organization_id (organizations.name); leave it empty when unknown.';
comment on column contacts.bio is
  'Short biography in Spanish (2-3 sentences): background (musician and instrument, or profession), training and notable facts, only from published sources. ChatGPT: same rules as background; put the page in bio_source.';
comment on column contacts.bio_source is 'https page the bio comes from.';
