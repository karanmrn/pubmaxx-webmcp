-- Keep Pal ownership validation inside the table write path. The original RLS
-- helper needed authenticated EXECUTE and was therefore exposed as a privileged
-- PostgREST RPC. A trigger preserves the invariant without a callable endpoint.

create or replace function public.validate_night_profile_pal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pub_pal_id is not null and not exists (
    select 1 from public.pub_pals
    where id = new.pub_pal_id and owner_id = new.owner_id
  ) then
    raise exception 'Night Profile Pal must belong to its owner'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_night_profile_pal()
  from public, anon, authenticated;

drop trigger if exists night_profiles_validate_pal on public.night_profiles;
create trigger night_profiles_validate_pal
before insert or update of owner_id, pub_pal_id on public.night_profiles
for each row execute function public.validate_night_profile_pal();

drop policy if exists night_profiles_owner_insert on public.night_profiles;
create policy night_profiles_owner_insert on public.night_profiles
for insert to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists night_profiles_owner_update on public.night_profiles;
create policy night_profiles_owner_update on public.night_profiles
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on function public.owns_night_profile_pal(uuid, uuid)
  from public, anon, authenticated;
drop function public.owns_night_profile_pal(uuid, uuid);

create index if not exists plan_completions_qualifying_arrival_action_idx
  on public.plan_completions(qualifying_arrival_action_id)
  where qualifying_arrival_action_id is not null;
