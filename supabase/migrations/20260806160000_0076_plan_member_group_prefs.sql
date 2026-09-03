-- Shared group preferences on Plans (Lane D). One preference row per plan
-- member; a rewrite upserts. Hard constraints (strictest budget, any
-- zero-proof / accessibility / weather-shelter ask) are derived in
-- application code from these rows and must never be silently relaxed.
-- Service-role write path; browser roles get no privileges. Captain applies.

create table if not exists public.plan_member_group_prefs (
  id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  budget_band text not null check (budget_band in ('under6', 'standard', 'flexible')),
  atmosphere_chip text not null check (atmosphere_chip in ('cosy', 'chatty', 'lively', 'music', 'food')),
  zero_proof boolean not null default false,
  accessibility_required boolean not null default false,
  weather_shelter_required boolean not null default false,
  idempotency_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (plan_id, member_id)
);

-- Idempotency ledger: a retried write with the same key returns the same row
-- rather than re-applying (mirrors plan_vibe_vote_requests in 0044).
create table if not exists public.plan_member_group_pref_requests (
  plan_id uuid not null references public.plans(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  idempotency_key text not null,
  budget_band text not null check (budget_band in ('under6', 'standard', 'flexible')),
  atmosphere_chip text not null check (atmosphere_chip in ('cosy', 'chatty', 'lively', 'music', 'food')),
  zero_proof boolean not null,
  accessibility_required boolean not null,
  weather_shelter_required boolean not null,
  created_at timestamptz not null,
  primary key (plan_id, member_id, idempotency_key)
);

create index if not exists plan_member_group_prefs_plan_idx
  on public.plan_member_group_prefs (plan_id);

alter table public.plan_member_group_prefs enable row level security;
alter table public.plan_member_group_pref_requests enable row level security;

revoke all on public.plan_member_group_prefs, public.plan_member_group_pref_requests
  from public, anon, authenticated;
grant all on public.plan_member_group_prefs, public.plan_member_group_pref_requests
  to service_role;

create or replace function public.record_plan_member_group_pref_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_budget_band text,
  p_atmosphere_chip text,
  p_zero_proof boolean,
  p_accessibility_required boolean,
  p_weather_shelter_required boolean,
  p_idempotency_key text,
  p_pref_id uuid,
  p_created_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pref public.plan_member_group_prefs%rowtype;
  v_request public.plan_member_group_pref_requests%rowtype;
begin
  if p_budget_band not in ('under6', 'standard', 'flexible') then return null; end if;
  if p_atmosphere_chip not in ('cosy', 'chatty', 'lively', 'music', 'food') then return null; end if;

  select * into v_request from public.plan_member_group_pref_requests
  where plan_id = p_plan_id and member_id = p_member_id and idempotency_key = p_idempotency_key;
  if found then
    select * into v_pref from public.plan_member_group_prefs
    where plan_id = p_plan_id and member_id = p_member_id;
    if not found then return null; end if;
    return jsonb_build_object(
      'id', v_pref.id,
      'plan_id', v_pref.plan_id,
      'member_id', v_pref.member_id,
      'budget_band', v_pref.budget_band,
      'atmosphere_chip', v_pref.atmosphere_chip,
      'zero_proof', v_pref.zero_proof,
      'accessibility_required', v_pref.accessibility_required,
      'weather_shelter_required', v_pref.weather_shelter_required,
      'created_at', v_pref.created_at,
      'updated_at', v_pref.updated_at
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text || ':' || p_member_id::text || ':group-pref', 0));

  select * into v_request from public.plan_member_group_pref_requests
  where plan_id = p_plan_id and member_id = p_member_id and idempotency_key = p_idempotency_key;
  if found then
    select * into v_pref from public.plan_member_group_prefs
    where plan_id = p_plan_id and member_id = p_member_id;
    if not found then return null; end if;
    return jsonb_build_object(
      'id', v_pref.id,
      'plan_id', v_pref.plan_id,
      'member_id', v_pref.member_id,
      'budget_band', v_pref.budget_band,
      'atmosphere_chip', v_pref.atmosphere_chip,
      'zero_proof', v_pref.zero_proof,
      'accessibility_required', v_pref.accessibility_required,
      'weather_shelter_required', v_pref.weather_shelter_required,
      'created_at', v_pref.created_at,
      'updated_at', v_pref.updated_at
    );
  end if;

  insert into public.plan_member_group_prefs (
    id, plan_id, member_id, budget_band, atmosphere_chip, zero_proof,
    accessibility_required, weather_shelter_required, idempotency_key, created_at, updated_at
  ) values (
    p_pref_id, p_plan_id, p_member_id, p_budget_band, p_atmosphere_chip, p_zero_proof,
    p_accessibility_required, p_weather_shelter_required, p_idempotency_key, p_created_at, p_created_at
  )
  on conflict (plan_id, member_id) do update set
    budget_band = excluded.budget_band,
    atmosphere_chip = excluded.atmosphere_chip,
    zero_proof = excluded.zero_proof,
    accessibility_required = excluded.accessibility_required,
    weather_shelter_required = excluded.weather_shelter_required,
    idempotency_key = excluded.idempotency_key,
    updated_at = excluded.updated_at
  returning * into v_pref;

  insert into public.plan_member_group_pref_requests (
    plan_id, member_id, idempotency_key, budget_band, atmosphere_chip, zero_proof,
    accessibility_required, weather_shelter_required, created_at
  ) values (
    p_plan_id, p_member_id, p_idempotency_key, p_budget_band, p_atmosphere_chip, p_zero_proof,
    p_accessibility_required, p_weather_shelter_required, p_created_at
  );

  return jsonb_build_object(
    'id', v_pref.id,
    'plan_id', v_pref.plan_id,
    'member_id', v_pref.member_id,
    'budget_band', v_pref.budget_band,
    'atmosphere_chip', v_pref.atmosphere_chip,
    'zero_proof', v_pref.zero_proof,
    'accessibility_required', v_pref.accessibility_required,
    'weather_shelter_required', v_pref.weather_shelter_required,
    'created_at', v_pref.created_at,
    'updated_at', v_pref.updated_at
  );
end;
$$;

revoke all on function public.record_plan_member_group_pref_atomic(
  uuid, uuid, text, text, boolean, boolean, boolean, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_plan_member_group_pref_atomic(
  uuid, uuid, text, text, boolean, boolean, boolean, text, uuid, timestamptz
) to service_role;
