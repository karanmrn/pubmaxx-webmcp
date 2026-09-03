-- "I'm here tonight" presence (PRD §1.5 / §5.1 tonight loop). One live row per
-- actor per venue; re-marking refreshes it. Auto-expires (2h). Public reads only
-- non-expired rows; writes are service-role only (server route), matching the
-- visit_reports / 0006 social RLS pattern.
--
-- APPLIED to production via the Supabase MCP (name: pub_presence). This file is
-- the repo-of-record; re-running it is idempotent.

create extension if not exists "pgcrypto";

create table if not exists public.pub_presence (
  id          uuid primary key default gen_random_uuid(),
  handle      text not null,
  venue_id    text not null,
  actor_hash  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '2 hours')
);

-- One live presence per actor per venue; the server upserts on this key to refresh.
create unique index if not exists pub_presence_actor_venue_uidx
  on public.pub_presence (actor_hash, venue_id);

create index if not exists pub_presence_venue_expires_idx
  on public.pub_presence (venue_id, expires_at desc);

alter table public.pub_presence enable row level security;

-- Public can read only non-expired presence. No anon insert/update: the service
-- role (server route) writes only.
drop policy if exists pub_presence_public_read on public.pub_presence;
create policy pub_presence_public_read
  on public.pub_presence
  for select
  using (expires_at > now());
