-- Preserve the exact food, transport, or extension option confirmed by the
-- host. The legacy terminal_venue_id remains the final canonical pub so old
-- readers and recap joins continue to work during rollout.

alter table public.plan_completions
  add column if not exists ending_selection jsonb;

alter table public.plan_completions
  add constraint plan_completions_ending_selection_chk check (
    ending_selection is null or (
      jsonb_typeof(ending_selection) = 'object'
      and ending_selection->>'kind' = ending
      and coalesce(ending_selection->>'optionId', '') <> ''
      and jsonb_typeof(ending_selection->'evidenceSnapshot') = 'object'
      and (ending <> 'food' or coalesce(ending_selection->>'externalPlaceId', '') <> '')
      and (ending <> 'keep_going' or coalesce(ending_selection->>'venueId', '') <> '')
    )
  );

-- Add a new overload instead of replacing the eight-argument function. This
-- lets an already-running deployment finish an in-flight legacy completion
-- while the new application starts persisting ending_selection.
create function public.complete_plan_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_completion_id uuid,
  p_action_id uuid,
  p_ending text,
  p_terminal_venue_id text,
  p_ending_selection jsonb,
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
  if actor_id <> (
    select id from public.plan_crew_members
    where plan_id = p_plan_id
    order by joined_at, id
    limit 1
  ) then return 'forbidden'; end if;
  if current_plan.route_revision <> p_expected_route_revision then return 'conflict'; end if;

  if exists (select 1 from public.plan_completions where plan_id = p_plan_id) then
    return 'already_completed';
  end if;
  if p_ending is null or p_ending not in ('food', 'get_home', 'keep_going') then return 'invalid'; end if;
  if p_ending = 'food' and p_terminal_venue_id is null then return 'invalid'; end if;
  if p_terminal_venue_id is not null and not exists (
    select 1 from public.plan_stops
    where plan_id = p_plan_id and venue_id = p_terminal_venue_id
  ) then return 'invalid'; end if;
  if p_ending_selection is null or (
    jsonb_typeof(p_ending_selection) <> 'object'
    or p_ending_selection->>'kind' <> p_ending
    or coalesce(p_ending_selection->>'optionId', '') = ''
    or jsonb_typeof(p_ending_selection->'evidenceSnapshot') <> 'object'
    or (p_ending = 'food' and coalesce(p_ending_selection->>'externalPlaceId', '') = '')
    or (p_ending = 'keep_going' and coalesce(p_ending_selection->>'venueId', '') = '')
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
    (id, plan_id, ending, terminal_venue_id, ending_selection, final_pint_drop_id, actor_member_id, route_revision, route_snapshot, completed_at)
  values
    (p_completion_id, p_plan_id, p_ending, p_terminal_venue_id, p_ending_selection, null, actor_id::text, current_plan.route_revision, snapshot, p_completed_at);
  return 'completed';
end;
$$;

revoke all on function public.complete_plan_atomic(uuid, text, integer, uuid, uuid, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_plan_atomic(uuid, text, integer, uuid, uuid, text, text, jsonb, timestamptz)
  to service_role;
