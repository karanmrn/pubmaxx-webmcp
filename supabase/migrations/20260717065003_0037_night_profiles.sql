-- Account-owned, versioned Night Profile preferences. Anonymous preferences
-- remain browser-local; this table is never addressed by handle or arbitrary uid.

create table if not exists public.night_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  schema_version smallint not null default 1 check (schema_version = 1),
  city_id text not null default 'london' check (
    city_id in ('london','manchester','liverpool','oxford','durham','glasgow','bristol','cambridge','bath')
  ),
  night_area text check (
    night_area is null or night_area in (
      'clapham','victoria','piccadilly-soho','canary-wharf','barnes','chiswick',
      'shoreditch','camden','brixton','bermondsey-london-bridge','kings-cross','islington',
      'dalston','peckham','greenwich','hammersmith','balham','marylebone','richmond','putney'
    )
  ),
  daypart text not null default 'evening'
    check (daypart in ('daytime','after_work','evening','late_night','get_home')),
  party_type text not null default 'friends'
    check (party_type in ('solo','friends','work')),
  group_size smallint check (group_size between 1 and 30),
  budget text not null default 'standard'
    check (budget in ('value','standard','treat')),
  budget_limit_pence integer check (budget_limit_pence between 500 and 50000),
  zero_proof boolean not null default false,
  atmosphere text[] not null default '{}' check (cardinality(atmosphere) <= 8),
  food_needs text[] not null default '{}' check (cardinality(food_needs) <= 8),
  accessibility text[] not null default '{}' check (cardinality(accessibility) <= 8),
  transport_constraints text[] not null default '{}' check (cardinality(transport_constraints) <= 8),
  briefing_preferences jsonb not null default '{"muteAll":false,"mutedAreas":[],"mutedTopics":[]}'::jsonb
    check (jsonb_typeof(briefing_preferences) = 'object'),
  voice_preference text not null default 'off'
    check (voice_preference in ('off','tts','ptt')),
  pub_pal_id uuid references public.pub_pals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists night_profiles_pub_pal_idx
  on public.night_profiles(pub_pal_id) where pub_pal_id is not null;

create or replace function public.owns_night_profile_pal(p_owner_id uuid, p_pub_pal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) = p_owner_id and (
    p_pub_pal_id is null or exists (
      select 1 from public.pub_pals
      where id = p_pub_pal_id and owner_id = p_owner_id
    )
  );
$$;

create or replace function public.touch_night_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists night_profiles_touch_updated_at on public.night_profiles;
create trigger night_profiles_touch_updated_at
before update on public.night_profiles
for each row execute function public.touch_night_profile_updated_at();

alter table public.night_profiles enable row level security;
revoke all on public.night_profiles from public, anon;
grant select, insert, update, delete on public.night_profiles to authenticated;

drop policy if exists night_profiles_owner_select on public.night_profiles;
create policy night_profiles_owner_select on public.night_profiles
for select to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists night_profiles_owner_insert on public.night_profiles;
create policy night_profiles_owner_insert on public.night_profiles
for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and public.owns_night_profile_pal(owner_id, pub_pal_id)
);

drop policy if exists night_profiles_owner_update on public.night_profiles;
create policy night_profiles_owner_update on public.night_profiles
for update to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and public.owns_night_profile_pal(owner_id, pub_pal_id)
);

drop policy if exists night_profiles_owner_delete on public.night_profiles;
create policy night_profiles_owner_delete on public.night_profiles
for delete to authenticated
using ((select auth.uid()) = owner_id);

revoke all on function public.touch_night_profile_updated_at() from public, anon, authenticated;
revoke all on function public.owns_night_profile_pal(uuid, uuid) from public, anon;
grant execute on function public.owns_night_profile_pal(uuid, uuid) to authenticated;
