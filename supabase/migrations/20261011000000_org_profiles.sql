-- ============================================================================
-- Organization profiles.
--
-- A visual "who are they" for festivals, venues and presenters: summary,
-- what they program, their venues (type, capacity), dates, audience, why /
-- how ADAR could collaborate, images, links and sources. Researched by
-- Claude (POST /api/assistant-agent/profiles) or edited by the owner on the
-- organization page. The JSON shape is validated by lib/organizations/profile.ts.
--
--   organizations.profile             jsonb, null = no profile yet
--   organizations.profile_updated_at  last time the profile was written
--
-- Idempotent: safe to run twice.
-- ============================================================================

alter table organizations add column if not exists profile jsonb;
alter table organizations add column if not exists profile_updated_at timestamptz;

alter table organizations drop constraint if exists organizations_profile_object;
alter table organizations add constraint organizations_profile_object
  check (profile is null or jsonb_typeof(profile) = 'object');
