-- Keep Story draft authorization and the service-role mutation in one database
-- statement. A contributor removal/demotion racing the edit therefore wins.

create or replace function public.update_night_story_draft_atomic(
  p_story_id uuid,
  p_actor_id uuid,
  p_title text,
  p_summary text,
  p_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_title is null or char_length(p_title) not between 1 and 120
    or p_summary is null or char_length(p_summary) > 500 then
    return false;
  end if;

  update public.night_stories as story
  set title = p_title,
      summary = p_summary,
      updated_at = p_updated_at
  where story.id = p_story_id
    and story.status = 'draft'
    and exists (
      select 1
      from public.night_story_contributors as contributor
      where contributor.story_id = story.id
        and contributor.profile_id = p_actor_id
        and contributor.status = 'accepted'
        and contributor.role in ('host', 'editor')
    );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.update_night_story_draft_atomic(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.update_night_story_draft_atomic(uuid, uuid, text, text, timestamptz) to service_role;

-- Promote a canonical completed Plan recap as one transaction. The advisory
-- lock serializes the partial owner/completion uniqueness key, and deterministic
-- Moment ids make retries update captions without changing creation time.
create or replace function public.create_plan_recap_atomic(
  p_owner_id uuid,
  p_completion_id uuid,
  p_title text,
  p_completed_at timestamptz,
  p_stops jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_memory_id uuid;
  v_completion public.plan_completions%rowtype;
  v_stop jsonb;
  v_position integer;
  v_canonical jsonb;
  v_moment_id uuid;
begin
  if p_title is null or char_length(p_title) not between 1 and 120
    or jsonb_typeof(p_stops) <> 'array'
    or jsonb_array_length(p_stops) not between 1 and 8 then
    return null;
  end if;

  select * into v_completion
  from public.plan_completions
  where id = p_completion_id;
  if not found or v_completion.completed_at <> p_completed_at then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_completion_id::text, 0));
  select id into v_memory_id
  from public.night_memories
  where owner_id = p_owner_id and plan_completion_id = p_completion_id;

  if v_memory_id is null then
    v_memory_id := gen_random_uuid();
    insert into public.night_memories (id, owner_id, title, plan_completion_id, visibility)
    values (v_memory_id, p_owner_id, p_title, p_completion_id, 'private');
  else
    update public.night_memories set title = p_title, updated_at = now() where id = v_memory_id;
  end if;

  for v_stop in select value from jsonb_array_elements(p_stops)
  loop
    v_position := (v_stop ->> 'position')::integer;
    v_canonical := v_completion.route_snapshot -> v_position;
    if v_position < 0
      or v_canonical is null
      or v_stop ->> 'venueId' is distinct from v_canonical ->> 'venueId'
      or char_length(coalesce(v_stop ->> 'caption', '')) > 500 then
      raise exception 'invalid canonical recap stop';
    end if;
    v_moment_id := (
      substr(md5(v_memory_id::text || ':plan-stop:' || v_position::text), 1, 8) || '-' ||
      substr(md5(v_memory_id::text || ':plan-stop:' || v_position::text), 9, 4) || '-4' ||
      substr(md5(v_memory_id::text || ':plan-stop:' || v_position::text), 14, 3) || '-a' ||
      substr(md5(v_memory_id::text || ':plan-stop:' || v_position::text), 18, 3) || '-' ||
      substr(md5(v_memory_id::text || ':plan-stop:' || v_position::text), 21, 12)
    )::uuid;
    insert into public.night_moments (
      id, memory_id, owner_id, kind, caption, venue_id, occurred_at, visibility
    ) values (
      v_moment_id, v_memory_id, p_owner_id, 'venue', coalesce(v_stop ->> 'caption', ''),
      v_stop ->> 'venueId', p_completed_at, 'private'
    )
    on conflict (id) do update set
      caption = excluded.caption,
      venue_id = excluded.venue_id,
      occurred_at = excluded.occurred_at;
  end loop;
  return v_memory_id;
end;
$$;

revoke all on function public.create_plan_recap_atomic(uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.create_plan_recap_atomic(uuid, uuid, text, timestamptz, jsonb) to service_role;
