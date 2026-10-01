-- Booking sheets: a project shown as a sheet of venues / presenters, one
-- booking deal (opportunity) per row; follow-ups and "last email" come from
-- the deal and its contact as everywhere else.
alter table projects add column if not exists sheet boolean not null default false;
alter table projects add column if not exists currency text not null default 'USD'
  check (currency ~ '^[A-Z]{3}$');

-- Dates proposed or confirmed for a booking, as the owner writes them
-- ("Mar 12–14, 2027", "spring 2027").
alter table opportunities add column if not exists event_dates text;
