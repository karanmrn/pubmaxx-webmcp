-- Rollback 0102: drop the message attachment columns and put the tombstone
-- trigger back to migration 0100's shape.
--
-- Dropping the columns forgets which messages carried a photo or a pub. The
-- words are untouched, which is what makes this lossless for the part of a
-- conversation people came for. A message that was ONLY a photo would be left
-- with an empty body under the restored `char_length(body) between 1 and 1000`
-- check, so those bodies are filled with one line first; the constraint is
-- restored after, and a re-apply of 0102 finds a valid table either way.
--
-- The Storage objects under `messages/` are NOT deleted here: a rollback is a
-- schema decision, and bytes a person sent are not something to remove as a
-- side effect of one. Nothing outside the dropped columns names them, so a
-- deliberate purge is a separate, explicit operation.

begin;

-- Say what happened, before the column that explained it goes away.
update public.messages
   set body = 'Photo removed.'
 where char_length(body) < 1
   and attachment_kind is not null;

alter table public.messages drop constraint if exists messages_attachment_dimensions_chk;
alter table public.messages drop constraint if exists messages_attachment_object_key_chk;
alter table public.messages drop constraint if exists messages_attachment_shape_chk;
alter table public.messages drop constraint if exists messages_attachment_kind_chk;
alter table public.messages drop constraint if exists messages_content_chk;
alter table public.messages drop constraint if exists messages_body_cap_chk;

alter table public.messages
  drop column if exists attachment_kind,
  drop column if exists attachment_object_key,
  drop column if exists attachment_width,
  drop column if exists attachment_height,
  drop column if exists attachment_venue_id;

-- 0019's body constraint, restored verbatim.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_body_len_chk') then
    alter table public.messages
      add constraint messages_body_len_chk
      check (char_length(body) between 1 and 1000);
  end if;
end $$;

-- 0100's trigger body, restored verbatim.
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

  delete from public.profile_cover_photos c
   using public.profiles p
   where p.id = c.profile_id
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
