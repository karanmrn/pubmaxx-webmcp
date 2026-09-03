-- Cron freshness plane (0047): durable backing for the Vercel cron freshness
-- jobs (app/api/cron/*). Apply AFTER 0046 (structured visit reports). ADDITIVE
-- ONLY — two new tables, no change to any existing object. House style mirrors
-- 0045_area_demand / 0046_structured_visit_reports:
--   • `create table if not exists` — idempotent, re-runnable.
--   • RLS enabled with NO anon/authenticated policy — the service-role cron
--     routes are the ONLY reader/writer. Neither table holds user data or PII;
--     they are operational caches (weather readings + a "when refreshed" stamp).
--   • No functions/RPCs are defined here, so there is NO function search_path to
--     pin (same as 0046). The tables carry no SECURITY DEFINER surface. Should a
--     helper function ever be added to this plane, it MUST be created with
--     `set search_path = ''` and schema-qualified refs, per house rule.
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the OWNER applies it LOUDLY via
-- MCP / `supabase db push` and runs the advisor pass. Until then the stores fail
-- soft to process-memory (lib/weatherSnapshotStore.ts, lib/feedFreshnessStore.ts)
-- and the read side falls back to the committed public/data/weather/latest.json —
-- so the app keeps working and the feeds become durable the moment this lands, no
-- code change (the same soft degradation area demand / vibe votes ship with).

-- ── weather_snapshots ────────────────────────────────────────────────────────
-- One row per night area (upserted every ~6h by /api/cron/refresh-weather),
-- carrying its latest Open-Meteo observation plus the batch `generated_at`. The
-- read side (lib/weatherSnapshots.server.ts) reconstructs a WeatherSnapshot from
-- these rows store-first, so tonight-conditions serves fresher data than the
-- committed file (which is read-only on Vercel's serverless FS and cannot be
-- rewritten by a scheduled function). `night_area` is the natural upsert key.
create table if not exists public.weather_snapshots (
  night_area                       text primary key,
  observed_at                      timestamptz not null,
  expires_at                       timestamptz not null,
  condition                        text not null,
  feels_like_c                     double precision not null,
  precipitation_probability_pct    double precision not null,
  wind_kph                         double precision,
  source_url                       text not null,
  source_publisher                 text not null,
  source_published_at              timestamptz not null,
  generated_at                     timestamptz not null,
  updated_at                       timestamptz not null default now()
);

-- Defence-in-depth range/shape checks mirroring lib/weatherSnapshots.ts
-- (validateWeatherObservation); the real contract lives in that module.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weather_snapshots_ranges_check') then
    alter table public.weather_snapshots
      add constraint weather_snapshots_ranges_check
      check (
        expires_at > observed_at
        and source_published_at <= observed_at
        and feels_like_c between -40 and 60
        and precipitation_probability_pct between 0 and 100
        and (wind_kph is null or (wind_kph >= 0 and wind_kph <= 300))
        and length(condition) between 1 and 120
        and length(source_publisher) between 1 and 160
      );
  end if;
end $$;

alter table public.weather_snapshots enable row level security;
-- Intentionally NO anon/authenticated policy: operational cache, service-role
-- only. The service-role cron route bypasses RLS.
revoke all on public.weather_snapshots from anon, authenticated;
grant all on public.weather_snapshots to service_role;

-- ── feed_freshness ───────────────────────────────────────────────────────────
-- A durable "when was this feed last revalidated" stamp for feeds the cron plane
-- refreshes but CANNOT re-persist to a committed file on serverless (chiefly the
-- What's-On tonight window — its full ingest can't run in a function). The
-- freshness spine (/api/freshness) and the freshness-audit cron overlay this so a
-- store-backed feed reports an honest observedAt, not the frozen generatedAt of
-- its committed baseline file. Metadata only — no user data, no PII.
create table if not exists public.feed_freshness (
  feed          text primary key,
  observed_at   timestamptz not null,
  rows_served   integer,
  note          text,
  updated_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feed_freshness_shape_check') then
    alter table public.feed_freshness
      add constraint feed_freshness_shape_check
      check (
        length(feed) between 1 and 80
        and (rows_served is null or rows_served >= 0)
        and (note is null or length(note) <= 300)
      );
  end if;
end $$;

alter table public.feed_freshness enable row level security;
revoke all on public.feed_freshness from anon, authenticated;
grant all on public.feed_freshness to service_role;
