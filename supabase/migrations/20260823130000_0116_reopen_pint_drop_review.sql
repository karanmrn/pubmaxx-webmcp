-- A new report after a moderator decision is new review evidence.
-- Re-open the row in the moderator lane without changing the verified-only
-- automatic-hide counter introduced by migration 0112.

create or replace function public.report_pint_drop_v2(
  p_id uuid,
  p_actor_hash text,
  p_reason text,
  p_hide_threshold int
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_count int;
begin
  if not exists (select 1 from public.visit_reports where id = p_id) then
    return null;
  end if;

  insert into public.pint_drop_verified_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    select verified_report_count into v_count
      from public.visit_reports
     where id = p_id;
    return v_count;
  end if;

  update public.visit_reports
     set verified_report_count = verified_report_count + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         moderated_at = case
                           when moderated_at is not null then null
                           else moderated_at
                         end,
         moderator_note = case
                            when moderated_at is not null then null
                            else moderator_note
                          end,
         status = case
                    when verified_report_count + 1 >= greatest(p_hide_threshold, 1)
                      then 'hidden'
                    else status
                  end
   where id = p_id
   returning verified_report_count into v_count;

  return v_count;
end;
$$;

revoke all on function public.report_pint_drop_v2(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.report_pint_drop_v2(uuid, text, text, int) to service_role;

-- Anonymous reports are review evidence, not an automatic hide counter. Keep
-- threshold-hidden rows hidden until a moderator decision. A row reopens only
-- when moderated_at proves that a moderator has acted on the previous queue
-- entry. The report ledger insert and state update remain one transaction.
create or replace function public.report_pint_drop_anonymous(
  p_id uuid,
  p_actor_hash text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  if not exists (select 1 from public.visit_reports where id = p_id) then
    return false;
  end if;

  insert into public.pint_drop_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    return true;
  end if;

  update public.visit_reports
     set reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         moderated_at = case
                           when moderated_at is not null then null
                           else moderated_at
                         end,
         moderator_note = case
                            when moderated_at is not null then null
                            else moderator_note
                          end
   where id = p_id;

  return true;
end;
$$;

revoke all on function public.report_pint_drop_anonymous(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_pint_drop_anonymous(uuid, text, text) to service_role;

-- Append one rotation-cover reporter under the row lock. Concurrent reporters
-- cannot overwrite each other's provenance or undercount the moderator queue.
create or replace function public.append_profile_cover_photo_report_actor(
  p_id uuid,
  p_actor text,
  p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer := 0;
  already boolean := false;
begin
  if p_actor is null or btrim(p_actor) = '' then return false; end if;

  update public.profile_cover_photos
     set report_actors = array_append(coalesce(report_actors, '{}'::text[]), p_actor),
         report_count = coalesce(cardinality(report_actors), 0) + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(btrim(p_reason), ''), report_reason),
         moderated_at = null
   where id = p_id
     and moderation_state = 'approved'
     and not (coalesce(report_actors, '{}'::text[]) @> array[p_actor]);
  get diagnostics moved = row_count;
  if moved > 0 then return true; end if;

  select moderation_state = 'approved'
         and coalesce(report_actors, '{}'::text[]) @> array[p_actor]
    into already
    from public.profile_cover_photos
   where id = p_id;
  return coalesce(already, false);
end;
$$;

revoke all on function public.append_profile_cover_photo_report_actor(uuid, text, text) from public, anon, authenticated;
grant execute on function public.append_profile_cover_photo_report_actor(uuid, text, text) to service_role;

-- Mirror and rotation are one public cover. Moderate both under one transaction
-- so concurrent hide and restore calls cannot publish a split decision.
create or replace function public.moderate_profile_cover_across_stores(
  p_handle text,
  p_state text,
  p_note text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  stamped_at timestamptz := now();
begin
  if p_state is null or p_state not in ('approved', 'hidden') then return false; end if;

  select id into v_profile_id
    from public.profiles
   where handle = lower(btrim(p_handle))
     and cover_object_key is not null
     and cover_generation is not null
     and cover_moderation_state in ('approved', 'hidden')
   for update;
  if v_profile_id is null then return false; end if;

  update public.profiles
     set cover_moderation_state = p_state,
         cover_moderated_at = stamped_at,
         cover_moderator_note = coalesce(nullif(btrim(p_note), ''), cover_moderator_note),
         updated_at = stamped_at
   where id = v_profile_id;

  update public.profile_cover_photos
     set moderation_state = p_state,
         moderated_at = stamped_at,
         moderator_note = coalesce(nullif(btrim(p_note), ''), moderator_note)
   where profile_id = v_profile_id;
  return true;
end;
$$;

revoke all on function public.moderate_profile_cover_across_stores(text, text, text) from public, anon, authenticated;
grant execute on function public.moderate_profile_cover_across_stores(text, text, text) to service_role;
