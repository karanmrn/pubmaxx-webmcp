-- 0053: Grounded one-Stop Plan lifecycle (§3.3, DAG L09).
--
-- Additive anchor metadata plus an immutable route_ready_at. Forward/back
-- compatible: legacy Plans read every new column as null; the anchored
-- generation flag gates whether any anchor is ever written, and rolling the flag
-- back leaves these columns dormant without any destructive change.

alter table public.plans
  add column if not exists anchor_venue_id text
    check (anchor_venue_id is null or char_length(anchor_venue_id) between 1 and 80),
  add column if not exists anchor_source text
    check (anchor_source is null or anchor_source in ('near', 'map-search', 'tonight', 'pal')),
  add column if not exists plan_outcome text
    check (plan_outcome is null or plan_outcome in ('route', 'anchor-only')),
  add column if not exists route_ready_at timestamptz;

-- Create accepts optional anchor metadata and stamps route_ready_at = created_at
-- for a grounded three-Stop route, never for a one-Stop anchor-only draft.
drop function if exists public.create_plan_idempotent_atomic(uuid, text, timestamptz, jsonb, uuid, text, text, timestamptz, text, text);

create function public.create_plan_idempotent_atomic(
  p_id uuid,
  p_title text,
  p_start_time timestamptz,
  p_stops jsonb,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_anchor_venue_id text default null,
  p_anchor_source text default null,
  p_outcome text default null
) returns text
language plpgsql security invoker set search_path = public
as $$
declare existing_plan public.plans%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:create:' || p_idempotency_key_hash, 0));
  select * into existing_plan from public.plans where creation_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_plan.creation_request_hash = p_request_hash and existing_plan.id = p_id then return 'replayed'; end if;
    return 'conflict';
  end if;

  insert into public.plans
    (id, title, start_time, creation_key_hash, creation_request_hash, anchor_venue_id, anchor_source, plan_outcome, route_ready_at)
  values (
    p_id, p_title, p_start_time, p_idempotency_key_hash, p_request_hash,
    p_anchor_venue_id, p_anchor_source, p_outcome,
    case when p_outcome = 'route' then now() else null end
  );
  insert into public.plan_stops (plan_id, venue_id, venue_name, position)
  select p_id, item.value->>'venueId', item.value->>'venueName', item.ordinality - 1
  from jsonb_array_elements(p_stops) with ordinality as item(value, ordinality);
  insert into public.plan_crew_members (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate)
  values (p_member_id, p_id, p_member_name, p_token_hash, 'in', p_joined_at, p_joined_at, true);
  return 'created';
end;
$$;

revoke all on function public.create_plan_idempotent_atomic(uuid, text, timestamptz, jsonb, uuid, text, text, timestamptz, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_plan_idempotent_atomic(uuid, text, timestamptz, jsonb, uuid, text, text, timestamptz, text, text, text, text, text) to service_role;

-- Route replacement preserves the accepted anchor at Stop 1 and stamps the
-- immutable route_ready_at on the first grounded three-Stop transition. An
-- anchored Plan can be upgraded only once the caller has verified the grounding
-- proof (p_grounded_upgrade). Legacy Plans keep the old behaviour; the new
-- parameter defaults to false so existing callers are unaffected.
drop function if exists public.replace_plan_route_atomic(uuid, text, integer, jsonb, jsonb);

create function public.replace_plan_route_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_stops jsonb,
  p_context jsonb,
  p_grounded_upgrade boolean default false
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_plan public.plans%rowtype;
  creator_id uuid;
  first_stop text;
begin
  select * into current_plan from public.plans where id = p_plan_id for update;
  if not found then return 'not_found'; end if;

  select member.id into creator_id
  from public.plan_crew_members member
  where member.plan_id = p_plan_id
  order by member.joined_at, member.id
  limit 1;
  if creator_id is null or not exists (
    select 1 from public.plan_crew_members
    where id = creator_id and token_hash = p_token_hash
  ) then return 'forbidden'; end if;

  if current_plan.status in ('completed', 'abandoned') then return 'invalid'; end if;
  if current_plan.route_revision <> p_expected_route_revision then return 'conflict'; end if;
  if jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) <> 3 then return 'invalid'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_stops) item
    where coalesce(item->>'venueId', '') = '' or coalesce(item->>'venueName', '') = ''
  ) or (select count(distinct item->>'venueId') from jsonb_array_elements(p_stops) item) <> 3 then
    return 'invalid';
  end if;

  -- The accepted anchor never moves off Stop 1 and never gains an ordinary Swap,
  -- and an anchored upgrade requires a verified grounding proof.
  first_stop := p_stops->0->>'venueId';
  if current_plan.anchor_venue_id is not null
     and (not p_grounded_upgrade or first_stop <> current_plan.anchor_venue_id) then
    return 'forbidden';
  end if;

  delete from public.plan_stops where plan_id = p_plan_id;
  insert into public.plan_stops (plan_id, venue_id, venue_name, position)
  select p_plan_id, item.value->>'venueId', item.value->>'venueName', item.ordinality - 1
  from jsonb_array_elements(p_stops) with ordinality as item(value, ordinality);
  update public.plans
  set route_revision = route_revision + 1,
      night_context = coalesce(p_context, night_context),
      plan_outcome = case when anchor_venue_id is not null then 'route' else plan_outcome end,
      route_ready_at = case when anchor_venue_id is not null then coalesce(route_ready_at, now()) else route_ready_at end
  where id = p_plan_id;
  return 'ok';
end;
$$;

revoke all on function public.replace_plan_route_atomic(uuid, text, integer, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.replace_plan_route_atomic(uuid, text, integer, jsonb, jsonb, boolean) to service_role;
