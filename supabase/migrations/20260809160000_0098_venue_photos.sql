-- Pub photo walls (0098): every venue gets a community wall of drink photos.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT A ROW IS: one approved photo, its author's stable profile actor, the
-- venue it belongs to, an optional drink tag from the app's closed taxonomy and
-- an optional 140-character caption. It is NOT a price: nothing here reaches
-- community_prices, the pins, the cheapest buckets or the Pint Index.
--
-- WHY THE OBJECT KEY IS CHECKED: the serving key is derived from the venue and
-- the row id, so the constraint below is the database saying the same thing
-- `lib/venuePhotos.venuePhotoServingKey` says. A row cannot name an object that
-- belongs to another venue, another photo, or the staging lane.
--
-- WHY THE CAP IS NOT A CONSTRAINT: 100 per account per venue is counted on the
-- write path against LIVE rows, because a moderator hide gives the slot back. A
-- CHECK cannot express "live", and a trigger would put the rule in two places
-- with only one of them explaining itself. The partial index below is what
-- makes that count cheap.
--
-- RLS: this table is service-role only, like every other app store. The browser
-- reads a wall through the API. No policy grants anon or authenticated anything
-- here, so the deny-by-default posture of migration 0065 stands; a future policy
-- must call `pubmax_private.rls_*` helpers (migration 0070 moved them out of
-- `public`, and a policy naming the old schema fails to create rather than
-- failing open).

begin;

create table if not exists public.venue_photos (
  id uuid primary key,
  venue_id text not null,
  author_actor text not null,
  author_profile_id uuid not null references public.profiles (id) on delete cascade,
  object_key text not null,
  drink_category text,
  caption text not null default '',
  width integer not null,
  height integer not null,
  moderation_state text not null default 'approved',
  report_count integer not null default 0,
  report_actors text[] not null default '{}'::text[],
  reported_at timestamptz,
  report_reason text,
  moderated_at timestamptz,
  moderator_note text,
  created_at timestamptz not null default now()
);

comment on table public.venue_photos is
  'Community photo wall rows, one per approved photo. Author identity is the stable profile actor; a photo is never a price.';
comment on column public.venue_photos.author_actor is
  'Stable profile actor (profile:{uuid}). Survives a public handle rename.';
comment on column public.venue_photos.object_key is
  'Private Storage key for the approved photo (venue-photos/{venue_id}/{id}.jpg). Staging keys are never stored.';
comment on column public.venue_photos.drink_category is
  'Optional tag from the app drink taxonomy (lib/drinks.ts). Null when untagged.';
comment on column public.venue_photos.moderation_state is
  'approved | needs_review | hidden. Only approved rows reach a public wall; hiding never deletes.';

-- Drop and recreate so a re-apply stays idempotent on the CHECK shapes.
alter table public.venue_photos drop constraint if exists venue_photos_object_key_check;
alter table public.venue_photos drop constraint if exists venue_photos_moderation_state_check;
alter table public.venue_photos drop constraint if exists venue_photos_drink_category_check;
alter table public.venue_photos drop constraint if exists venue_photos_caption_check;
alter table public.venue_photos drop constraint if exists venue_photos_author_actor_check;
alter table public.venue_photos drop constraint if exists venue_photos_report_count_check;
alter table public.venue_photos drop constraint if exists venue_photos_dimensions_check;

-- Serving key only, and only this venue's own folder.
alter table public.venue_photos
  add constraint venue_photos_object_key_check
  check (object_key = ('venue-photos/' || venue_id || '/' || id::text || '.jpg'));

alter table public.venue_photos
  add constraint venue_photos_moderation_state_check
  check (moderation_state in ('approved', 'needs_review', 'hidden'));

-- Mirrors DRINK_CATEGORIES in lib/drinks.ts. A new category needs a migration,
-- which is the point: the taxonomy is closed on both sides or it is not closed.
alter table public.venue_photos
  add constraint venue_photos_drink_category_check
  check (
    drink_category is null
    or drink_category in (
      'beer', 'wine', 'whisky', 'gin', 'vodka', 'rum', 'cocktail', 'shot',
      'alcohol-free', 'soft-drink', 'coffee', 'other'
    )
  );

alter table public.venue_photos
  add constraint venue_photos_caption_check
  check (char_length(caption) <= 140);

alter table public.venue_photos
  add constraint venue_photos_author_actor_check
  check (author_actor = ('profile:' || author_profile_id::text));

alter table public.venue_photos
  add constraint venue_photos_report_count_check
  check (report_count >= 0);

alter table public.venue_photos
  add constraint venue_photos_dimensions_check
  check (width > 0 and height > 0);

-- The wall's own read: one venue, newest first, approved only. The id is in the
-- key because the keyset page boundary breaks ties on it.
create index if not exists venue_photos_wall_idx
  on public.venue_photos (venue_id, created_at desc, id desc)
  where moderation_state = 'approved';

-- The cap count: one account, one venue, live rows.
create index if not exists venue_photos_author_venue_idx
  on public.venue_photos (author_profile_id, venue_id)
  where moderation_state = 'approved';

-- The moderator queue and the hidden lane, the same two the other flagged
-- surfaces carry, so a hide stays reversible from the surface that made it.
create index if not exists venue_photos_reported_idx
  on public.venue_photos (reported_at desc nulls last)
  where report_count > 0 and moderated_at is null;

create index if not exists venue_photos_hidden_idx
  on public.venue_photos (moderated_at desc nulls last)
  where moderation_state = 'hidden';

alter table public.venue_photos enable row level security;
revoke all on table public.venue_photos from anon, authenticated;

-- ── Tombstone: an account that leaves takes its photos with it ───────────────
-- The row cascade above deletes the records; Storage has no foreign key, so the
-- objects are deleted here, in the same trigger that already clears the owned
-- avatar and cover. Both keys go: the approved one and any staging bytes a
-- refused upload left behind.
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
