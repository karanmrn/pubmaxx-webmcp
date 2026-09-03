-- 0105: Appending a reporter to an owned image is ONE statement.
--
-- `reportOwnedImage` read `*_report_actors`, appended in JavaScript and wrote the
-- whole array back. Two reporters who read the same base array each wrote
-- [base, self], so the later write dropped the earlier reporter and
-- `*_report_count` undercounted. Nothing auto-hides on that count, so this was a
-- data-integrity defect rather than a takedown bypass - but the reporter set is
-- what a moderator reads.
--
-- Postgres appends atomically. The UPDATE's own predicate carries the
-- approved-state gate and the per-actor uniqueness guard, and the row lock makes
-- a concurrent second reporter re-evaluate that predicate against the committed
-- row, so both appends land.
--
-- Slot is a closed set, spelled out rather than assembled, so no caller can name
-- a column.

create or replace function public.append_profile_image_report_actor(
  p_handle text,
  p_slot text,
  p_actor text,
  p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  eligible boolean;
  already boolean;
  moved integer := 0;
  stamped_at timestamptz := now();
begin
  if p_slot is null or p_slot not in ('avatar', 'cover') then return false; end if;
  if p_handle is null or btrim(p_handle) = '' then return false; end if;
  if p_actor is null or btrim(p_actor) = '' then return false; end if;

  if p_slot = 'avatar' then
    select
      avatar_moderation_state = 'approved'
        and avatar_object_key is not null
        and avatar_generation is not null,
      coalesce(avatar_report_actors, '{}'::text[]) @> array[p_actor]
    into eligible, already
    from public.profiles
    where handle = p_handle;

    if not coalesce(eligible, false) then return false; end if;
    if coalesce(already, false) then return true; end if;

    update public.profiles
    set
      avatar_report_actors =
        array_append(coalesce(avatar_report_actors, '{}'::text[]), p_actor),
      avatar_report_count =
        coalesce(cardinality(avatar_report_actors), 0) + 1,
      avatar_reported_at = stamped_at,
      avatar_report_reason = coalesce(nullif(btrim(p_reason), ''), avatar_report_reason),
      -- A fresh flag after "keep visible" re-opens the reported lane.
      avatar_moderated_at = null,
      updated_at = stamped_at
    where handle = p_handle
      and avatar_moderation_state = 'approved'
      and avatar_object_key is not null
      and avatar_generation is not null
      and not (coalesce(avatar_report_actors, '{}'::text[]) @> array[p_actor]);
    get diagnostics moved = row_count;

    if moved > 0 then return true; end if;

    -- Zero rows means somebody else moved the row between the read and the
    -- write. The actor being present now is still the outcome this call wanted.
    select coalesce(avatar_report_actors, '{}'::text[]) @> array[p_actor]
    into already
    from public.profiles
    where handle = p_handle;
    return coalesce(already, false);
  end if;

  select
    cover_moderation_state = 'approved'
      and cover_object_key is not null
      and cover_generation is not null,
    coalesce(cover_report_actors, '{}'::text[]) @> array[p_actor]
  into eligible, already
  from public.profiles
  where handle = p_handle;

  if not coalesce(eligible, false) then return false; end if;
  if coalesce(already, false) then return true; end if;

  update public.profiles
  set
    cover_report_actors =
      array_append(coalesce(cover_report_actors, '{}'::text[]), p_actor),
    cover_report_count =
      coalesce(cardinality(cover_report_actors), 0) + 1,
    cover_reported_at = stamped_at,
    cover_report_reason = coalesce(nullif(btrim(p_reason), ''), cover_report_reason),
    cover_moderated_at = null,
    updated_at = stamped_at
  where handle = p_handle
    and cover_moderation_state = 'approved'
    and cover_object_key is not null
    and cover_generation is not null
    and not (coalesce(cover_report_actors, '{}'::text[]) @> array[p_actor]);
  get diagnostics moved = row_count;

  if moved > 0 then return true; end if;

  select coalesce(cover_report_actors, '{}'::text[]) @> array[p_actor]
  into already
  from public.profiles
  where handle = p_handle;
  return coalesce(already, false);
end;
$$;

-- Reporter actor hashes never leave the store, and this function reads them, so
-- only the service role may call it. Browser roles keep no EXECUTE at all.
revoke all on function public.append_profile_image_report_actor(text, text, text, text) from public;
revoke all on function public.append_profile_image_report_actor(text, text, text, text) from anon;
revoke all on function public.append_profile_image_report_actor(text, text, text, text) from authenticated;
grant execute on function public.append_profile_image_report_actor(text, text, text, text) to service_role;
