-- Profile tombstone after auth.users deletion.
--
-- Production still holds many legacy anonymous-era profiles with user_id null.
-- Those rows stay LIVE. Auth deletion alone (ON DELETE SET NULL on
-- profiles.user_id) must not make a profile "gone" — that would kill
-- attribution for every unlinked handle.
--
-- Explicit marker: profiles.tombstoned_at. A BEFORE DELETE trigger on
-- auth.users stamps it while user_id still matches OLD.id; the existing FK
-- then clears user_id. Resolve and public profile reads gate "gone" only on
-- tombstoned_at is not null. The handle stays reserved (row remains).
-- Captain applies. Agents ship SQL only.

alter table public.profiles
  add column if not exists tombstoned_at timestamptz null;

comment on column public.profiles.tombstoned_at is
  'Set when the linked auth.users row is deleted. Null means live, including legacy anonymous-era rows with user_id null.';

create index if not exists profiles_tombstoned_at_idx
  on public.profiles (tombstoned_at)
  where tombstoned_at is not null;

-- Stamp tombstone while user_id still points at the departing auth user.
-- Runs BEFORE the FK ON DELETE SET NULL clears user_id.
create or replace function public.stamp_profile_tombstone_on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set tombstoned_at = coalesce(tombstoned_at, now()),
         updated_at = now()
   where user_id = old.id;
  return old;
end;
$$;

drop trigger if exists profiles_tombstone_on_auth_user_delete on auth.users;
create trigger profiles_tombstone_on_auth_user_delete
  before delete on auth.users
  for each row
  execute function public.stamp_profile_tombstone_on_auth_user_delete();

revoke all on function public.stamp_profile_tombstone_on_auth_user_delete() from public, anon, authenticated;
