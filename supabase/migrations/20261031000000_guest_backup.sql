-- Backups among the staff and artists of a concert: on call in case someone
-- drops out. Listed apart and left out of the counts.

alter table concert_guests add column backup boolean not null default false;

comment on column concert_guests.backup is
  'True for a backup (a stand-by musician or crew member, only comes if needed). Backups are listed apart and not counted with the staff and artists.';
