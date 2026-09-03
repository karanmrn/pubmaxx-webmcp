-- Message attachments (0102): a message may carry ONE photo or ONE pub.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT A ROW GAINS: `attachment_kind` and the columns that belong to whichever
-- kind it is. The set is closed at two, and the consistency CHECK below is the
-- database saying the same sentence `lib/messageAttachments.ts` says: a photo
-- row carries an object key and its dimensions and no venue; a venue row
-- carries a venue id and no bytes; a plain message carries neither.
--
-- WHY THE OBJECT KEY IS CHECKED: the serving key is derived from the
-- conversation and the message id, so a row cannot name an object that belongs
-- to another conversation, another message, or the staging lane.
--
-- WHY THE BODY CHECK MOVES: a photo sent without a caption is a message. The
-- old `char_length(body) between 1 and 1000` would have made the words the
-- point of a picture, so the length cap stays and the "say something" half
-- becomes its own constraint that an attachment can satisfy.
--
-- WHAT A PUB CARD DOES NOT STORE: any coordinate at all. The row holds a venue
-- id; the name, the area and any figure the card is allowed to print are
-- resolved on the read path. The viewer-coordinate egress law (`lib/geo.ts`) is
-- untouched by design, and a price frozen here would be an undated claim
-- nobody could correct.
--
-- RLS: unchanged and deliberately stricter than the social tables. Migration
-- 0019 enabled RLS on public.messages with NO policies, and this migration adds
-- none: every read is mediated by the server route (service role) behind the
-- courtesy participant check. Never add a public-read policy to this table.

begin;

alter table public.messages
  add column if not exists attachment_kind       text,
  add column if not exists attachment_object_key text,
  add column if not exists attachment_width      integer,
  add column if not exists attachment_height     integer,
  add column if not exists attachment_venue_id   text;

comment on column public.messages.attachment_kind is
  'photo | venue | null. The closed set in lib/messageAttachments.ts.';
comment on column public.messages.attachment_object_key is
  'Private Storage key for a message photo (messages/{conversation_id}/{id}.jpg). Staging keys are never stored.';
comment on column public.messages.attachment_venue_id is
  'Curated venue id of a shared pub. No coordinate is stored; the card is resolved on the read path.';

-- Drop and recreate so a re-apply stays idempotent on the CHECK shapes.
alter table public.messages drop constraint if exists messages_body_len_chk;
alter table public.messages drop constraint if exists messages_body_cap_chk;
alter table public.messages drop constraint if exists messages_content_chk;
alter table public.messages drop constraint if exists messages_attachment_kind_chk;
alter table public.messages drop constraint if exists messages_attachment_shape_chk;
alter table public.messages drop constraint if exists messages_attachment_object_key_chk;
alter table public.messages drop constraint if exists messages_attachment_dimensions_chk;

-- The cap alone. Mirrors MAX_MESSAGE_BODY in lib/messages.ts; keep the two in
-- lockstep.
alter table public.messages
  add constraint messages_body_cap_chk
  check (char_length(body) <= 1000);

-- A message has to BE something: words, an attachment, or both.
alter table public.messages
  add constraint messages_content_chk
  check (char_length(body) >= 1 or attachment_kind is not null);

alter table public.messages
  add constraint messages_attachment_kind_chk
  check (attachment_kind is null or attachment_kind in ('photo', 'venue'));

-- Each kind owns its own columns, and nothing else's.
alter table public.messages
  add constraint messages_attachment_shape_chk
  check (
    (
      attachment_kind is null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
      and attachment_venue_id is null
    )
    or (
      attachment_kind = 'photo'
      and attachment_object_key is not null
      and attachment_width is not null
      and attachment_height is not null
      and attachment_venue_id is null
    )
    or (
      attachment_kind = 'venue'
      and attachment_venue_id is not null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
    )
  );

-- Serving key only, and only this conversation's own folder.
alter table public.messages
  add constraint messages_attachment_object_key_chk
  check (
    attachment_object_key is null
    or attachment_object_key = ('messages/' || conversation_id::text || '/' || id::text || '.jpg')
  );

alter table public.messages
  add constraint messages_attachment_dimensions_chk
  check (
    (attachment_width is null and attachment_height is null)
    or (attachment_width > 0 and attachment_height > 0)
  );

-- ── Tombstone: an account that leaves takes its message PHOTOS with it ───────
-- The words stay. A conversation is two people's, so deleting one side's
-- sentences would rewrite the other side's record of it; the pictures are the
-- part that belongs to the person who left, so the objects go and the columns
-- are cleared. Message photos are keyed by CONVERSATION, not by profile, so the
-- objects are found through the rows - by the sender's public handle, which is
-- what a message stores.
--
-- Restated whole because `create or replace function` replaces the whole body
-- and drops any SET clause it does not carry: the `search_path` line below is
-- load-bearing, not decoration.
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

  -- Wall photos are keyed by VENUE, not by profile, so the objects are found
  -- through the rows rather than through a key prefix.
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

  -- The rotation's rows. The cascade on profiles would not fire (the profile
  -- row stays as a tombstone), so they are deleted explicitly, exactly like the
  -- wall photos above.
  delete from public.profile_cover_photos c
   using public.profiles p
   where p.id = c.profile_id
     and p.user_id = old.id;

  -- Message photos: the bytes, then the columns that pointed at them.
  delete from storage.objects o
   using public.messages m
   join public.profiles p on p.handle = m.sender_handle
   where p.user_id = old.id
     and m.attachment_object_key is not null
     and o.bucket_id = 'pint-drops'
     and (
       o.name = m.attachment_object_key
       or o.name = replace(m.attachment_object_key, '.jpg', '.staging.jpg')
     );

  -- The message keeps its words. When it had none, one line says the photo is
  -- gone, because a blank bubble in somebody else's thread explains nothing and
  -- the content CHECK above would refuse it anyway.
  update public.messages m
     set body = case when char_length(m.body) >= 1 then m.body else 'Photo removed.' end,
         attachment_kind = null,
         attachment_object_key = null,
         attachment_width = null,
         attachment_height = null,
         attachment_venue_id = null
    from public.profiles p
   where p.handle = m.sender_handle
     and p.user_id = old.id
     and m.attachment_kind is not null;

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
