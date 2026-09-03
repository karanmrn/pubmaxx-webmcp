-- Rollback for 0078_profile_tombstone.

drop trigger if exists profiles_tombstone_on_auth_user_delete on auth.users;
drop function if exists public.stamp_profile_tombstone_on_auth_user_delete();
drop index if exists public.profiles_tombstoned_at_idx;
alter table public.profiles drop column if exists tombstoned_at;
