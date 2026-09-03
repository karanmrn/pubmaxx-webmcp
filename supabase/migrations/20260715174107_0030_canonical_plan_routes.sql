-- Authoritative canonical Crawl Route revisions and all-or-nothing completion.
-- Browser roles remain unable to call these RPCs; the server service role is
-- the only caller and supplies a hashed member capability.

alter table public.plans
  add column if not exists route_revision integer not null default 1
    check (route_revision >= 1);

alter table public.plan_completions
  add column if not exists route_revision integer,
  add column if not exists route_snapshot jsonb;

update public.plan_completions completion
set route_revision = plan.route_revision,
    route_snapshot = coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'venueId', stop.venue_id,
          'venueName', stop.venue_name,
          'position', stop.position
        )
        order by stop.position
      )
      from public.plan_stops stop
      where stop.plan_id = completion.plan_id
    ), '[]'::jsonb)
from public.plans plan
where completion.plan_id = plan.id
  and (completion.route_revision is null or completion.route_snapshot is null);

alter table public.plan_completions
  alter column route_revision set not null,
  alter column route_snapshot set not null;

create or replace function public.replace_plan_route_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_stops jsonb,
  p_context jsonb
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_plan public.plans%rowtype;
  creator_id uuid;
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

  delete from public.plan_stops where plan_id = p_plan_id;
  insert into public.plan_stops (plan_id, venue_id, venue_name, position)
  select p_plan_id, item.value->>'venueId', item.value->>'venueName', item.ordinality - 1
  from jsonb_array_elements(p_stops) with ordinality as item(value, ordinality);
  update public.plans
  set route_revision = route_revision + 1,
      night_context = coalesce(p_context, night_context)
  where id = p_plan_id;
  return 'ok';
end;
$$;

drop function if exists public.complete_plan_atomic(uuid, text, integer, uuid, uuid, text, text, uuid, timestamptz);

create function public.complete_plan_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_completion_id uuid,
  p_action_id uuid,
  p_ending text,
  p_terminal_venue_id text,
  p_completed_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_plan public.plans%rowtype;
  actor_id uuid;
  snapshot jsonb;
begin
  select * into current_plan from public.plans where id = p_plan_id for update;
  if not found then return 'not_found'; end if;

  select id into actor_id from public.plan_crew_members
  where plan_id = p_plan_id and token_hash = p_token_hash;
  if actor_id is null then return 'forbidden'; end if;
  if current_plan.route_revision <> p_expected_route_revision then return 'conflict'; end if;

  -- A retry with the same canonical revision returns the original record and
  -- never creates a second ending action.
  if exists (select 1 from public.plan_completions where plan_id = p_plan_id) then
    return 'already_completed';
  end if;
  if p_ending is null or p_ending not in ('food', 'get_home', 'keep_going') then return 'invalid'; end if;
  if p_ending = 'food' and p_terminal_venue_id is null then return 'invalid'; end if;
  if p_terminal_venue_id is not null and not exists (
    select 1 from public.plan_stops
    where plan_id = p_plan_id and venue_id = p_terminal_venue_id
  ) then return 'invalid'; end if;
  select jsonb_agg(
    jsonb_build_object('venueId', stop.venue_id, 'venueName', stop.venue_name, 'position', stop.position)
    order by stop.position
  ) into snapshot
  from public.plan_stops stop where stop.plan_id = p_plan_id;

  insert into public.plan_actions (id, plan_id, actor_member_id, type, ending, created_at)
  values (p_action_id, p_plan_id, actor_id, 'ending', p_ending, p_completed_at);
  update public.plans set status = 'completed', ending = p_ending where id = p_plan_id;
  insert into public.plan_completions
    (id, plan_id, ending, terminal_venue_id, final_pint_drop_id, actor_member_id, route_revision, route_snapshot, completed_at)
  values
    (p_completion_id, p_plan_id, p_ending, p_terminal_venue_id, null, actor_id::text, current_plan.route_revision, snapshot, p_completed_at);
  return 'completed';
end;
$$;

revoke all on function public.replace_plan_route_atomic(uuid, text, integer, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_plan_atomic(uuid, text, integer, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_plan_route_atomic(uuid, text, integer, jsonb, jsonb) to service_role;
grant execute on function public.complete_plan_atomic(uuid, text, integer, uuid, uuid, text, text, timestamptz) to service_role;
