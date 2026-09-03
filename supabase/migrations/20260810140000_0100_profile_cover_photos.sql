-- Rotating cover photos (0100): a profile's backdrop becomes up to FIVE photos
-- that take turns behind the name. Captain / firstmate applies. Agents ship
-- SQL only, and this migration must run BEFORE the code that reads it deploys.
--
-- WHAT A ROW IS: one approved cover photo, its owner's profile, its 1-based
-- rotation position, and the generation that names its bytes. It is the same
-- storage lane the single cover already uses (`covers/{profile_id}/{generation}/
-- cover.jpg`), so nothing about the upload journey, the EXIF strip, the
-- advisory scan or the write-side proof changes: only the number of them.
--
-- WHY THE OBJECT KEY IS CHECKED: the serving key is derived from the profile
-- and the generation, so the constraint below is the database saying the same
-- thing `lib/profileImageSlots.profileImageServingKey` says. A row cannot name
-- an object that belongs to another profile, another generation, or staging.
--
-- WHY POSITION IS DEFERRABLE-UNIQUE: a reorder is a permutation, so two rows
-- swap numbers inside one statement. A plain unique index would refuse that
-- half way through; deferring the check to commit lets the whole settled order
-- be judged at once, which is the only state anybody reads.
--
-- WHY COVER #1 STAYS IN `profiles`: `profiles.cover_*` remains the back-compat
-- lane every surface that only knows one cover still reads, and the app mirrors
-- whichever row is at position 1 into it after every change. The backfill below
-- seeds this table from that column, so an owner who set a cover yesterday
-- keeps it as cover #1 with nothing to redo.
--
-- WHY THE CAP IS NOT A CONSTRAINT: five per profile is counted on the write
-- path against LIVE rows, because a moderator hide gives the slot back. A CHECK
-- cannot express "live", and a trigger would put the rule in two places with
-- only one of them explaining itself.
--
-- RLS: service-role only, like every other app store. The browser reads a
-- rotation through the API. No policy grants anon or authenticated anything
-- here, so migration 0065's deny-by-default posture stands; a future policy
-- must call `pubmax_private.rls_*` helpers (migration 0070 moved them out of
-- `public`, and a policy naming the old schema fails to create rather than
-- failing open).

begin;

create table if not exists public.profile_cover_photos (
  id uuid primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null,
  generation uuid not null,
  object_key text not null,
  moderation_state text not null default 'approved',
  report_count integer not null default 0,
  report_actors text[] not null default '{}'::text[],
  reported_at timestamptz,
  report_reason text,
  moderated_at timestamptz,
  moderator_note text,
  created_at timestamptz not null default now()
);

comment on table public.profile_cover_photos is
  'Rotating profile cover photos, one row per approved photo. Position is 1-based and owner-chosen; cover #1 is mirrored into profiles.cover_* for back-compat.';
comment on column public.profile_cover_photos.position is
  '1-based rotation order. Rewritten whole on a move, so the settled list is always 1..n.';
comment on column public.profile_cover_photos.object_key is
  'Private Storage key for the approved photo (covers/{profile_id}/{generation}/cover.jpg). Staging keys are never stored.';
comment on column public.profile_cover_photos.moderation_state is
  'approved | needs_review | hidden. Only approved rows reach a card; hiding never deletes.';

-- Drop and recreate so a re-apply stays idempotent on the CHECK shapes.
alter table public.profile_cover_photos
  drop constraint if exists profile_cover_photos_object_key_check;
alter table public.profile_cover_photos
  drop constraint if exists profile_cover_photos_moderation_state_check;
alter table public.profile_cover_photos
  drop constraint if exists profile_cover_photos_position_check;
alter table public.profile_cover_photos
  drop constraint if exists profile_cover_photos_report_count_check;
alter table public.profile_cover_photos
  drop constraint if exists profile_cover_photos_generation_key;
alter table public.profile_cover_photos
  drop constraint if exists profile_cover_photos_position_key;

-- Serving key only, and only this profile's own generation folder.
alter table public.profile_cover_photos
  add constraint profile_cover_photos_object_key_check
  check (object_key = ('covers/' || profile_id::text || '/' || generation::text || '/cover.jpg'));

alter table public.profile_cover_photos
  add constraint profile_cover_photos_moderation_state_check
  check (moderation_state in ('approved', 'needs_review', 'hidden'));

-- The cap is counted in the app against live rows; this only says a position is
-- a real slot in the rotation rather than a free-form integer.
alter table public.profile_cover_photos
  add constraint profile_cover_photos_position_check
  check (position >= 1 and position <= 5);

alter table public.profile_cover_photos
  add constraint profile_cover_photos_report_count_check
  check (report_count >= 0);

-- One row per generation per profile: the generation names the bytes, so two
-- rows sharing one would be two rows owning one object.
alter table public.profile_cover_photos
  add constraint profile_cover_photos_generation_key
  unique (profile_id, generation);

-- Deferred, because a reorder swaps positions inside one statement.
alter table public.profile_cover_photos
  add constraint profile_cover_photos_position_key
  unique (profile_id, position) deferrable initially deferred;

-- The rotation's own read: one profile, in order, approved only.
create index if not exists profile_cover_photos_rotation_idx
  on public.profile_cover_photos (profile_id, position, created_at, id)
  where moderation_state = 'approved';

-- The moderator queue and the hidden lane, the same two every other flagged
-- surface carries, so a hide stays reversible from the surface that made it.
create index if not exists profile_cover_photos_reported_idx
  on public.profile_cover_photos (reported_at desc nulls last)
  where report_count > 0 and moderated_at is null;

create index if not exists profile_cover_photos_hidden_idx
  on public.profile_cover_photos (moderated_at desc nulls last)
  where moderation_state = 'hidden';

alter table public.profile_cover_photos enable row level security;
revoke all on table public.profile_cover_photos from anon, authenticated;

-- ── Backfill: today's single cover becomes cover #1 ──────────────────────────
-- Every profile that currently holds an approved cover gets one row at position
-- 1 naming the same generation and the same object, so nothing an owner already
-- uploaded has to be uploaded again. Idempotent: a re-apply inserts nothing,
-- because the generation is already recorded for that profile.
insert into public.profile_cover_photos (
  id, profile_id, position, generation, object_key, moderation_state, created_at
)
select
  gen_random_uuid(),
  p.id,
  1,
  p.cover_generation,
  p.cover_object_key,
  'approved',
  coalesce(p.updated_at, now())
from public.profiles p
where p.cover_object_key is not null
  and p.cover_generation is not null
  and p.cover_moderation_state = 'approved'
  and p.cover_object_key = ('covers/' || p.id::text || '/' || p.cover_generation::text || '/cover.jpg')
  and not exists (
    select 1
      from public.profile_cover_photos c
     where c.profile_id = p.id
       and c.generation = p.cover_generation
  );

-- ── Tombstone: an account that leaves takes every cover with it ──────────────
-- The row cascade above deletes the records; Storage has no foreign key, so the
-- objects are deleted here. The existing `covers/{profile_id}/%` prefix delete
-- already covers every generation of every cover, which is exactly why the
-- rotation reuses that lane rather than inventing a second one. The wall-photo
-- and profile-column clauses are 0098's, restated so this function stays the
-- one definition of what leaving takes.
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
