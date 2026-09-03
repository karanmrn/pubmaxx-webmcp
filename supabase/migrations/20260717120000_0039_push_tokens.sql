-- Device push-token registry for the Capacitor native shell (lib/pushTokenStore.ts).
-- One row per device token; re-registration upserts on token and refreshes
-- last_seen_at. Rows carry NO identity (registration happens pre-auth) — the
-- table only says "this device can receive pushes". All access goes through the
-- service-role client server-side; anon/authenticated get nothing.

create table if not exists public.push_tokens (
  token text primary key check (char_length(btrim(token)) between 1 and 512),
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

revoke all on public.push_tokens from anon, authenticated;
