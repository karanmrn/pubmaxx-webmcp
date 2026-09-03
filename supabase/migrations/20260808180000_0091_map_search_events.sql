-- Map search intent telemetry (no free-text queries).
-- Captain applies; agents ship SQL only.

create table if not exists public.map_search_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  intent_primary text not null,
  query_length integer not null check (query_length >= 0 and query_length <= 200),
  national_hit_count integer not null default 0
    check (national_hit_count >= 0 and national_hit_count <= 100),
  national_status text not null check (national_status in ('ready', 'degraded'))
);

create index if not exists map_search_events_created_at_idx
  on public.map_search_events (created_at desc);

create index if not exists map_search_events_intent_idx
  on public.map_search_events (intent_primary, created_at desc);

alter table public.map_search_events enable row level security;

-- Service-role writes only; no browser SELECT on the raw event stream.
revoke all on table public.map_search_events from anon, authenticated;
grant select, insert on table public.map_search_events to service_role;
grant usage, select on sequence public.map_search_events_id_seq to service_role;
