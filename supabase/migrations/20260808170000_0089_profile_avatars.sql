-- Owned profile avatars: storage-key columns, CHECK-pinned object path, and
-- tombstone cleanup that deletes Storage objects (skeptic ADD on WP2).
-- Captain applies. Agents ship SQL only.

alter table public.profiles
  add column if not exists avatar_object_key text,
  add column if not exists avatar_generation uuid,
  add column if not exists avatar_moderation_state text;

comment on column public.profiles.avatar_object_key is
  'Private Storage key for the owned avatar (avatars/{profile_id}/{generation}/image.jpg). Null when none.';
comment on column public.profiles.avatar_generation is
  'Opaque generation id for the current owned avatar. Null when none.';
comment on column public.profiles.avatar_moderation_state is
  'owned-avatar moderation: pending | approved | needs_review | hidden. Null when none.';

-- Drop and recreate so re-apply stays idempotent on the CHECK shape.
alter table public.profiles
  drop constraint if exists profiles_avatar_object_key_check;
alter table public.profiles
  drop constraint if exists profiles_avatar_moderation_state_check;
alter table public.profiles
  drop constraint if exists profiles_avatar_fields_consistent_check;

alter table public.profiles
  add constraint profiles_avatar_moderation_state_check
  check (
    avatar_moderation_state is null
    or avatar_moderation_state in ('pending', 'approved', 'needs_review', 'hidden')
  );

-- Serving key only (never staging). UUID profile id + generation, fixed suffix.
alter table public.profiles
  add constraint profiles_avatar_object_key_check
  check (
    avatar_object_key is null
    or avatar_object_key = (
      'avatars/' || id::text || '/' || avatar_generation::text || '/image.jpg'
    )
  );

alter table public.profiles
  add constraint profiles_avatar_fields_consistent_check
  check (
    (
      avatar_object_key is null
      and avatar_generation is null
      and avatar_moderation_state is null
    )
    or (
      avatar_object_key is not null
      and avatar_generation is not null
      and avatar_moderation_state is not null
    )
  );

-- Extend 0078's tombstone stamp: delete every avatar object for the departing
-- profile (all generations under avatars/{id}/) and null the avatar fields so
-- a deleted account's face cannot persist in Storage or cache.
create or replace function public.stamp_profile_tombstone_on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  -- Remove owned avatar bytes first (serving + staging, every generation).
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
