-- Profile avatar report/takedown lane (Social Launch WP4).
-- Reader flags queue for a human; only a moderator hides; hide never deletes.
-- Captain applies. Agents ship SQL only.

alter table public.profiles
  add column if not exists avatar_report_count integer not null default 0,
  add column if not exists avatar_reported_at timestamptz,
  add column if not exists avatar_report_reason text,
  add column if not exists avatar_report_actors text[] not null default '{}'::text[],
  add column if not exists avatar_moderated_at timestamptz,
  add column if not exists avatar_moderator_note text;

comment on column public.profiles.avatar_report_count is
  'Distinct reporter count for the current owned avatar. A flag never hides.';
comment on column public.profiles.avatar_reported_at is
  'When the latest distinct avatar report was recorded.';
comment on column public.profiles.avatar_report_reason is
  'Latest reader reason for the avatar report queue.';
comment on column public.profiles.avatar_report_actors is
  'Hashed reporter actors for the current owned avatar (per-actor dedupe).';
comment on column public.profiles.avatar_moderated_at is
  'When a moderator last kept-visible or hid the owned avatar.';
comment on column public.profiles.avatar_moderator_note is
  'Optional moderator note on the latest avatar decision.';

alter table public.profiles
  drop constraint if exists profiles_avatar_report_count_check;

alter table public.profiles
  add constraint profiles_avatar_report_count_check
  check (avatar_report_count >= 0);

create index if not exists profiles_avatar_reported_idx
  on public.profiles (avatar_reported_at desc nulls last)
  where avatar_report_count > 0
    and avatar_moderated_at is null
    and avatar_moderation_state = 'approved'
    and avatar_object_key is not null;

create index if not exists profiles_avatar_hidden_idx
  on public.profiles (avatar_moderated_at desc nulls last)
  where avatar_moderation_state = 'hidden'
    and avatar_object_key is not null;

-- Tombstone path: clear report provenance with the face bytes (WP2 + WP4).
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
