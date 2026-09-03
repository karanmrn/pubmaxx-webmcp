-- Wanted Wave A (0093): private places a drinker means to try.
-- Paste-only capture; source_url is provenance and is NEVER fetched from
-- Instagram/TikTok by the server. Solo Wanted only — no collaborative surface.
-- Apply AFTER 0092. House style: idempotent DDL, RLS owner-only, service-role
-- is the app write path (requireSupabaseAdmin).

create table if not exists public.wanteds (
  id               uuid primary key default gen_random_uuid(),
  -- Stable profile actor string (`profile:{uuid}`), matching contribution
  -- identity. Not a free-text handle: renames must not strand Wanteds.
  owner_actor      text not null,
  -- curated | uk_base | pending
  venue_kind       text not null,
  venue_id         text,
  venue_name       text,
  source_url       text,
  source_platform  text not null default 'none',
  note             text not null default '',
  raw_paste        text not null default '',
  status           text not null default 'open',
  created_at       timestamptz not null default now(),
  fulfilled_at     timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wanteds_venue_kind_check') then
    alter table public.wanteds
      add constraint wanteds_venue_kind_check
      check (venue_kind in ('curated', 'uk_base', 'pending'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wanteds_status_check') then
    alter table public.wanteds
      add constraint wanteds_status_check
      check (status in ('open', 'fulfilled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wanteds_platform_check') then
    alter table public.wanteds
      add constraint wanteds_platform_check
      check (source_platform in ('instagram', 'tiktok', 'youtube', 'other', 'none'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wanteds_note_len_check') then
    alter table public.wanteds
      add constraint wanteds_note_len_check
      check (length(note) <= 140);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wanteds_raw_paste_len_check') then
    alter table public.wanteds
      add constraint wanteds_raw_paste_len_check
      check (length(raw_paste) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wanteds_resolved_shape_check') then
    alter table public.wanteds
      add constraint wanteds_resolved_shape_check
      check (
        (venue_kind = 'pending' and (venue_id is null or venue_id = ''))
        or (venue_kind in ('curated', 'uk_base') and venue_id is not null and length(venue_id) > 0)
      );
  end if;
end $$;

create index if not exists wanteds_owner_created_idx
  on public.wanteds (owner_actor, created_at desc);

create index if not exists wanteds_owner_open_venue_idx
  on public.wanteds (owner_actor, venue_id)
  where status = 'open' and venue_id is not null;

alter table public.wanteds enable row level security;

-- Owner SELECT via JWT profile match. owner_actor is `profile:{uuid}`;
-- rls_owns_profile takes the uuid. Extract with substring after the prefix.
-- Helper lives in pubmax_private after migration 0070 (not public).
revoke all on table public.wanteds from anon, authenticated;
grant select, insert, update, delete on table public.wanteds to authenticated;
grant select, insert, update, delete on table public.wanteds to service_role;

drop policy if exists wanteds_owner_select on public.wanteds;
create policy wanteds_owner_select
  on public.wanteds
  for select
  to authenticated
  using (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

drop policy if exists wanteds_owner_insert on public.wanteds;
create policy wanteds_owner_insert
  on public.wanteds
  for insert
  to authenticated
  with check (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

drop policy if exists wanteds_owner_update on public.wanteds;
create policy wanteds_owner_update
  on public.wanteds
  for update
  to authenticated
  using (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  )
  with check (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

drop policy if exists wanteds_owner_delete on public.wanteds;
create policy wanteds_owner_delete
  on public.wanteds
  for delete
  to authenticated
  using (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

drop policy if exists wanteds_anon_deny on public.wanteds;
create policy wanteds_anon_deny
  on public.wanteds
  for all
  to anon
  using (false)
  with check (false);
