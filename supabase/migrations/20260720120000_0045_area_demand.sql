-- Area demand (0045): durable backing for the demand capture on the honest
-- unsupported-area preview (Wayfinder 3.2). When PUBMAXX cannot serve an area,
-- a user can register that they want it; this table records that signal so
-- coverage can be prioritised by real demand. Apply AFTER 0044 (plan vibe
-- votes). House style mirrors 0042_email_subscribers / 0043_social_loop:
--   • `create table if not exists` — idempotent, re-runnable.
--   • RLS enabled with NO public/raw policy — the service-role route is the ONLY
--     reader/writer. `email` is PII and never leaves the API boundary; there is
--     no anon / authenticated SELECT/INSERT/UPDATE/DELETE policy on purpose.
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the OWNER applies via
-- MCP / `supabase db push` and runs the advisor pass. Until then
-- lib/areaDemandStore.ts fails soft to process-memory, so capture keeps working
-- and becomes durable the moment this lands (no code change needed) — the same
-- soft degradation vibe votes (#435) ship with.
--
-- PRIVACY / TASTE DOCTRINE:
--   • `area` is free text as the user SAID it (e.g. 'Peckham'). No coordinates
--     are ever stored — the taste doctrine forbids raw location in the payload.
--   • `email` is OPTIONAL and nullable: most rows carry NO contact at all
--     (demand is captured without it). An address is stored only when the user
--     offers one for a heads-up. Service-role only, API-only, never public.
--   • `matched_patch_id` records the supported patch the area text resolved to
--     (or null when it named no supported patch) — honest provenance for how the
--     signal was bucketed.
--   • `source` records where the capture happened, constrained to a known
--     allowlist so a spoofed body can't invent an arbitrary source string.
--   • Not deduped: each expression of demand is a distinct signal (a re-tap is a
--     genuine "still want this"). Table growth is bounded by the route's durable
--     per-IP + global rate limit, not by a unique constraint.

create table if not exists public.area_demand (
  id               uuid primary key default gen_random_uuid(),
  area             text not null,
  area_key         text not null,
  matched_patch_id text,
  source           text not null default 'map-miss',
  email            text,
  created_at       timestamptz not null default now()
);

-- Source allowlist: only known capture surfaces may write. Keeps provenance
-- honest and blocks a spoofed body from inventing an arbitrary source string.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'area_demand_source_check'
  ) then
    alter table public.area_demand
      add constraint area_demand_source_check
      check (source in ('near-empty', 'area-picker', 'map-miss'));
  end if;
end $$;

-- Defence-in-depth: a non-empty area within the domain cap, and (when present)
-- a lower-cased address with an '@'. The real rules live in lib/areaDemand.ts.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'area_demand_area_check'
  ) then
    alter table public.area_demand
      add constraint area_demand_area_check
      check (length(area) between 1 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'area_demand_email_check'
  ) then
    alter table public.area_demand
      add constraint area_demand_email_check
      check (email is null or (position('@' in email) > 1 and email = lower(email) and length(email) <= 254));
  end if;
end $$;

-- Coverage-prioritisation reads group by the normalised area key.
create index if not exists area_demand_area_key_idx on public.area_demand (area_key);

alter table public.area_demand enable row level security;

drop policy if exists area_demand_public_read on public.area_demand;
-- Intentionally NO SELECT/INSERT/UPDATE/DELETE policy for anon / authenticated
-- roles: an optional email is PII, and the demand signal is service-role-only.
-- The service-role route bypasses RLS. Service-role only, by construction.
revoke all on public.area_demand from anon, authenticated;
grant all on public.area_demand to service_role;
