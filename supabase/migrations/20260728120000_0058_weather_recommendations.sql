-- Authored weather Recommendations. One row is one Pubmaxxer's short opinion
-- that a venue suits one condition from the closed product vocabulary.
--
-- This is separate from reviews, weather snapshots, and operational night
-- signals. Weather only decides which authored rows match current conditions.
-- It never creates a Recommendation.
--
-- The contributor handle is public attribution and the future leaderboard key.
-- actor_hash is the private server-derived origin token used for abuse controls
-- and audit provenance. Raw rows stay service-role only.

create table if not exists public.weather_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            text not null,
  condition           text not null,
  reason              text not null,
  contributor_handle  text not null,
  actor_hash           text not null,
  submitted_at         timestamptz not null default now(),
  constraint weather_recommendations_owner_key
    unique (venue_id, condition, contributor_handle)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'weather_recommendations_shape_check'
  ) then
    alter table public.weather_recommendations
      add constraint weather_recommendations_shape_check
      check (
        char_length(venue_id) between 1 and 64
        and condition in ('warm', 'clear', 'raining', 'cold', 'windy')
        and char_length(reason) between 8 and 160
        and contributor_handle ~ '^[a-z0-9_]{1,30}$'
        and char_length(actor_hash) between 1 and 160
      );
  end if;
end $$;

create index if not exists weather_recommendations_venue_recent_idx
  on public.weather_recommendations (venue_id, submitted_at desc);

create index if not exists weather_recommendations_contributor_idx
  on public.weather_recommendations (contributor_handle);

alter table public.weather_recommendations enable row level security;
revoke all on public.weather_recommendations from anon, authenticated;
grant all on public.weather_recommendations to service_role;
