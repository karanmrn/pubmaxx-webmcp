-- Rollback for 0090 profile avatar report/takedown columns.
-- Restores the 0089 tombstone function shape (avatar fields only).

drop index if exists public.profiles_avatar_hidden_idx;
drop index if exists public.profiles_avatar_reported_idx;

alter table public.profiles
  drop constraint if exists profiles_avatar_report_count_check;

alter table public.profiles
  drop column if exists avatar_moderator_note,
  drop column if exists avatar_moderated_at,
  drop column if exists avatar_report_actors,
  drop column if exists avatar_report_reason,
  drop column if exists avatar_reported_at,
  drop column if exists avatar_report_count;

create or replace function public.stamp_profile_tombstone_on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects o
   using public.profiles p
   where p.user_id = old.id
     and o.bucket_id = 'pint-drops'
     and o.name like ('avatars/' || p.id::text || '/%');

  update public.profiles
     set tombstoned_at = coalesce(tombstoned_at, now()),
         avatar_url = null,
         avatar_object_key = null,
         avatar_generation = null,
         avatar_moderation_state = null,
         updated_at = now()
   where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.stamp_profile_tombstone_on_auth_user_delete() from public, anon, authenticated;
