alter table public.wanteds
  add column if not exists promoted_list_type text,
  add column if not exists promoted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wanteds_promotion_pair_check'
      and conrelid = 'public.wanteds'::regclass
  ) then
    alter table public.wanteds
      add constraint wanteds_promotion_pair_check
      check (
        (promoted_list_type is null and promoted_at is null)
        or (
          promoted_list_type is not null
          and promoted_at is not null
          and char_length(promoted_list_type) between 1 and 60
        )
      );
  end if;
end
$$;

create or replace function public.promote_wanted_to_saved_list(
  p_owner_actor text,
  p_profile_id uuid,
  p_wanted_id uuid,
  p_venue_id text,
  p_list_type text
)
returns table (
  outcome text,
  promoted_list_type text,
  promoted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wanted public.wanteds%rowtype;
  v_promoted_at timestamptz := now();
begin
  select *
    into v_wanted
    from public.wanteds
   where id = p_wanted_id
     and owner_actor = p_owner_actor
   for update;

  if not found then
    return query select 'not_found'::text, null::text, null::timestamptz;
    return;
  end if;

  if p_owner_actor <> ('profile:' || p_profile_id::text)
     or v_wanted.status <> 'open'
     or v_wanted.venue_kind <> 'curated'
     or v_wanted.venue_id is distinct from p_venue_id then
    return query select 'not_promotable'::text, null::text, null::timestamptz;
    return;
  end if;

  if v_wanted.promoted_list_type is not null then
    if v_wanted.promoted_list_type = p_list_type then
      insert into public.saved_pubs (profile_id, venue_id, list_type, note)
      values (p_profile_id, p_venue_id, p_list_type, null)
      on conflict (profile_id, venue_id, list_type) do nothing;
      return query select
        'already_saved'::text,
        v_wanted.promoted_list_type,
        v_wanted.promoted_at;
    else
      return query select 'already_promoted'::text, null::text, null::timestamptz;
    end if;
    return;
  end if;

  insert into public.saved_pubs (profile_id, venue_id, list_type, note)
  values (p_profile_id, p_venue_id, p_list_type, null)
  on conflict (profile_id, venue_id, list_type) do nothing;

  update public.wanteds
     set promoted_list_type = p_list_type,
         promoted_at = v_promoted_at
   where id = p_wanted_id;

  return query select 'saved'::text, p_list_type, v_promoted_at;
end
$$;

revoke all on function public.promote_wanted_to_saved_list(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.promote_wanted_to_saved_list(text, uuid, uuid, text, text)
  to service_role;
