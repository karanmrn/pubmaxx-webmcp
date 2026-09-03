-- A rich profile (0096): a cover photo slot and the card fields a person types
-- in about themselves. Captain / firstmate applies. Agents ship SQL only.
--
-- The cover takes the SAME journey as the face (0089/0090): private staging,
-- an image scan, promotion to a serving key this CHECK pins, a reader-flag lane
-- a moderator alone can act on, and deletion of every object on tombstone. It
-- is a second slot, not a second pipeline.
--
-- RLS: these columns live on public.profiles, which already carries owner-only
-- SELECT (`profiles_owner_select`, migration 0067) plus service-role writes, so
-- the cover inherits the face's posture and needs no new policy. Any future
-- policy on this table must call `pubmax_private.rls_owns_profile(...)`: 0070
-- moved the helpers out of `public`, and a policy naming the old schema fails to
-- create rather than failing open.
--
-- The card fields are PUBLIC BY CHOICE, like bio and avatar. The private set
-- (email, date of birth, gender, full legal name) stays in
-- public.private_account_identities and is not touched here.

begin;

alter table public.profiles
  add column if not exists cover_object_key text,
  add column if not exists cover_generation uuid,
  add column if not exists cover_moderation_state text,
  add column if not exists cover_report_count integer not null default 0,
  add column if not exists cover_reported_at timestamptz,
  add column if not exists cover_report_reason text,
  add column if not exists cover_report_actors text[] not null default '{}'::text[],
  add column if not exists cover_moderated_at timestamptz,
  add column if not exists cover_moderator_note text,
  add column if not exists favourite_drink text,
  add column if not exists interests text,
  add column if not exists workplace text;

comment on column public.profiles.cover_object_key is
  'Private Storage key for the owned cover (covers/{profile_id}/{generation}/cover.jpg). Null when none.';
comment on column public.profiles.cover_generation is
  'Opaque generation id for the current owned cover. Null when none.';
comment on column public.profiles.cover_moderation_state is
  'owned-cover moderation: pending | approved | needs_review | hidden. Null when none.';
comment on column public.profiles.cover_report_count is
  'Distinct reporter count for the current owned cover. A flag never hides.';
comment on column public.profiles.cover_report_actors is
  'Hashed reporter actors for the current owned cover (per-actor dedupe).';
comment on column public.profiles.favourite_drink is
  'Public by choice: the drink this account orders. Free text, never a price.';
comment on column public.profiles.interests is
  'Public by choice: what this account is into on a night out.';
comment on column public.profiles.workplace is
  'Public by choice: where this account works. Display text only, never a company page.';

-- Drop and recreate so re-apply stays idempotent on the CHECK shape.
alter table public.profiles
  drop constraint if exists profiles_cover_object_key_check;
alter table public.profiles
  drop constraint if exists profiles_cover_moderation_state_check;
alter table public.profiles
  drop constraint if exists profiles_cover_fields_consistent_check;
alter table public.profiles
  drop constraint if exists profiles_cover_report_count_check;
alter table public.profiles
  drop constraint if exists profiles_favourite_drink_len_check;
alter table public.profiles
  drop constraint if exists profiles_interests_len_check;
alter table public.profiles
  drop constraint if exists profiles_workplace_len_check;

alter table public.profiles
  add constraint profiles_cover_moderation_state_check
  check (
    cover_moderation_state is null
    or cover_moderation_state in ('pending', 'approved', 'needs_review', 'hidden')
  );

-- Serving key only (never staging). UUID profile id + generation, fixed suffix.
alter table public.profiles
  add constraint profiles_cover_object_key_check
  check (
    cover_object_key is null
    or cover_object_key = (
      'covers/' || id::text || '/' || cover_generation::text || '/cover.jpg'
    )
  );

alter table public.profiles
  add constraint profiles_cover_fields_consistent_check
  check (
    (
      cover_object_key is null
      and cover_generation is null
      and cover_moderation_state is null
    )
    or (
      cover_object_key is not null
      and cover_generation is not null
      and cover_moderation_state is not null
    )
  );

alter table public.profiles
  add constraint profiles_cover_report_count_check
  check (cover_report_count >= 0);

-- The caps the API and the store already enforce, restated where the data
-- lives, so a direct write cannot store a longer value than a reader expects.
alter table public.profiles
  add constraint profiles_favourite_drink_len_check
  check (favourite_drink is null or length(favourite_drink) <= 40);

alter table public.profiles
  add constraint profiles_interests_len_check
  check (interests is null or length(interests) <= 140);

alter table public.profiles
  add constraint profiles_workplace_len_check
  check (workplace is null or length(workplace) <= 60);

create index if not exists profiles_cover_reported_idx
  on public.profiles (cover_reported_at desc nulls last)
  where cover_report_count > 0
    and cover_moderated_at is null
    and cover_moderation_state = 'approved'
    and cover_object_key is not null;

create index if not exists profiles_cover_hidden_idx
  on public.profiles (cover_moderated_at desc nulls last)
  where cover_moderation_state = 'hidden'
    and cover_object_key is not null;

-- Tombstone path (0078 -> 0089 -> 0090 -> here): a departing account's cover
-- bytes and its report provenance leave with the face, and the card fields the
-- person typed about themselves are cleared with them.
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
