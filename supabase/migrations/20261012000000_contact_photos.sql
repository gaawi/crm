-- ============================================================================
-- Contact photos.
--
-- A face next to each person in lists, the contact page, Today, Approvals and
-- campaigns. Found by Claude on a public page (POST
-- /api/assistant-agent/contact-photos) or pasted by the owner on the contact
-- page. Shown with referrerPolicy="no-referrer"; initials when there is none
-- or it fails to load.
--
--   contacts.photo_url         https image URL, null = initials
--   contacts.photo_source      https page where the photo was found (credit)
--   contacts.photo_updated_at  last time the photo was set or removed
--
-- Idempotent: safe to run twice.
-- ============================================================================

alter table contacts add column if not exists photo_url text;
alter table contacts add column if not exists photo_source text;
alter table contacts add column if not exists photo_updated_at timestamptz;

alter table contacts drop constraint if exists contacts_photo_url_https;
alter table contacts add constraint contacts_photo_url_https
  check (photo_url is null or (photo_url ~ '^https://[^\s/]+[^\s]*$' and length(photo_url) <= 2048));

alter table contacts drop constraint if exists contacts_photo_source_https;
alter table contacts add constraint contacts_photo_source_https
  check (photo_source is null or (photo_source ~ '^https://[^\s/]+[^\s]*$' and length(photo_source) <= 2048));
