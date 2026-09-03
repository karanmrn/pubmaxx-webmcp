-- Walk-route leg cache (0049): durable backing for the road-following crawl
-- route. The /api/walk-route handler routes each stop pair through
-- OpenRouteService foot-walking and caches the returned pavement geometry HERE,
-- keyed by the rounded stop pair (lib/walkRoute legCacheKey), so a crawl's N-1
-- legs are shared across reversed/edited routes and ORS calls stay far under
-- quota. Apply AFTER 0048 (operator rail). House style mirrors
-- 0045_area_demand / 0047_cron_freshness_plane:
--   • `create table if not exists` — idempotent, re-runnable.
--   • RLS enabled with NO public/raw policy — the service-role route is the ONLY
--     reader/writer. There is no anon / authenticated policy on purpose.
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the OWNER applies via
-- MCP / `supabase db push` and runs the advisor pass. Until then
-- lib/walkRouteStore.ts fails soft to process-memory, so the cache still works
-- per-instance and becomes durable the moment this lands (no code change needed)
-- — the same soft degradation area demand (#435) and the weather plane ship with.
--
-- DATA / TASTE DOCTRINE:
--   • `leg_key` is a rounded `fromLng,fromLat>toLng,toLat` string (~5dp, ~1m).
--     It carries pub-to-pub coordinates that are already PUBLIC venue data, not
--     any user location — the crawl is built from the venue dataset.
--   • `coordinates` is the routed [lng,lat] LineString ORS returned for the leg.
--   • `expires_at` bounds a row's usefulness (~1 month; pavements don't move).
--     Reads filter on it and stale rows are simply re-routed and re-upserted.
--   • No user identity, no IP, no PII of any kind is stored here.

create table if not exists public.walk_route_legs (
  leg_key     text primary key,
  coordinates jsonb not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Reads discard expired rows; index the expiry so the freshness filter is cheap.
create index if not exists walk_route_legs_expires_at_idx
  on public.walk_route_legs (expires_at);

alter table public.walk_route_legs enable row level security;

drop policy if exists walk_route_legs_public_read on public.walk_route_legs;
-- Intentionally NO SELECT/INSERT/UPDATE/DELETE policy for anon / authenticated
-- roles: the routed-leg cache is written and read only by the service-role
-- walk-route handler, which bypasses RLS. Service-role only, by construction.
revoke all on public.walk_route_legs from anon, authenticated;
grant all on public.walk_route_legs to service_role;
