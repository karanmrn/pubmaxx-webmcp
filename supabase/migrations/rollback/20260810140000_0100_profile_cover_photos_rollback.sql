-- Rollback 0100: drop the rotating cover photos and put the tombstone trigger
-- back to migration 0098's shape.
--
-- Dropping the table deletes every rotation row. `profiles.cover_*` is
-- untouched, so every profile keeps the cover it was already wearing: cover #1
-- was mirrored into those columns after every change, which is what makes this
-- rollback lossless for the backdrop a card actually paints. Covers #2 to #5
-- stop being reachable, because nothing outside this table names them.
--
-- The Storage objects under `covers/` are NOT deleted here: a rollback is a
-- schema decision, and bytes a person uploaded are not something to remove as a
-- side effect of one. Re-applying 0100 therefore finds cover #1's object intact
-- and rebuilds its row from the backfill; a deliberate purge of the rest is a
-- separate, explicit operation.

begin;

drop table if exists public.profile_cover_photos;

-- 0098's trigger body, restored verbatim.
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
     and (
       o.name like ('avatars/' || p.id::text || '/%')
       or o.name like ('covers/' || p.id::text || '/%')
     );

  delete from storage.objects o
   using public.venue_photos vp
   join public.profiles p on p.id = vp.author_profile_id
   where p.user_id = old.id
     and o.bucket_id = 'pint-drops'
     and (o.name = vp.object_key or o.name = replace(vp.object_key, '.jpg', '.staging.jpg'));

  delete from public.venue_photos vp
   using public.profiles p
   where p.id = vp.author_profile_id
     and p.user_id = old.id;

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
         cover_object_key = null,
         cover_generation = null,
         cover_moderation_state = null,
         cover_report_count = 0,
         cover_reported_at = null,
         cover_report_reason = null,
         cover_report_actors = '{}'::text[],
         cover_moderated_at = null,
         cover_moderator_note = null,
         favourite_drink = null,
         interests = null,
         workplace = null,
         updated_at = now()
   where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.stamp_profile_tombstone_on_auth_user_delete() from public, anon, authenticated;

commit;
