-- Rollback 0096: drop the cover slot and the card fields, and put the tombstone
-- trigger back to migration 0090's face-only shape.
--
-- Dropping the columns deletes cover provenance and the text people typed about
-- themselves. The cover BYTES are not reachable from SQL once the keys are gone,
-- so this removes them first, exactly as the tombstone path would.

begin;

delete from storage.objects o
 using public.profiles p
 where o.bucket_id = 'pint-drops'
   and o.name like ('covers/' || p.id::text || '/%');

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
         avatar_report_count = 0,
         avatar_reported_at = null,
         avatar_report_reason = null,
         avatar_report_actors = '{}'::text[],
         avatar_moderated_at = null,
         avatar_moderator_note = null,
         updated_at = now()
   where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.stamp_profile_tombstone_on_auth_user_delete() from public, anon, authenticated;

drop index if exists public.profiles_cover_reported_idx;
drop index if exists public.profiles_cover_hidden_idx;

alter table public.profiles
  drop constraint if exists profiles_cover_object_key_check,
  drop constraint if exists profiles_cover_moderation_state_check,
  drop constraint if exists profiles_cover_fields_consistent_check,
  drop constraint if exists profiles_cover_report_count_check,
  drop constraint if exists profiles_favourite_drink_len_check,
  drop constraint if exists profiles_interests_len_check,
  drop constraint if exists profiles_workplace_len_check;

alter table public.profiles
  drop column if exists cover_object_key,
  drop column if exists cover_generation,
  drop column if exists cover_moderation_state,
  drop column if exists cover_report_count,
  drop column if exists cover_reported_at,
  drop column if exists cover_report_reason,
  drop column if exists cover_report_actors,
  drop column if exists cover_moderated_at,
  drop column if exists cover_moderator_note,
  drop column if exists favourite_drink,
  drop column if exists interests,
  drop column if exists workplace;

commit;
