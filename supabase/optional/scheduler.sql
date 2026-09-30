-- Optional scheduler: call the app's cron endpoint every 5 minutes from
-- Supabase (pg_cron + pg_net). Use this on Vercel Hobby, where Vercel Cron
-- runs only once a day. It keeps imports moving, catches up any missed
-- push notifications and runs the autopilot.
--
-- 1. Replace YOUR-APP and YOUR_CRON_SECRET below.
-- 2. Run in the Supabase SQL editor.
-- To remove: select cron.unschedule('crm-sync');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'crm-sync',
  '*/5 * * * *',
  $$
    select net.http_get(
      url := 'https://YOUR-APP.vercel.app/api/cron/sync?async=1',
      headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
      timeout_milliseconds := 10000
    );
  $$
);
