-- iPhone / browser notifications (Web Push). One row per device that turned
-- them on in Settings. The VAPID key pair lives in app_settings 'push_vapid'
-- (private key encrypted with TOKEN_ENCRYPTION_KEY); app_settings 'push_state'
-- keeps what was already notified.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text
);

alter table push_subscriptions enable row level security;

comment on table push_subscriptions is
  'Devices that receive notifications (Web Push), added from Settings in the app. ChatGPT: do not edit; rows are created and removed by the app.';
