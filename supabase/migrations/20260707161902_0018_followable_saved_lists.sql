-- Followable saved-pub lists (IDEAS B3). Apply AFTER 0010.
--
-- Runtime semantics:
--   • A row means one profile follows another profile's named saved-pub list.
--   • The named list is `public.saved_pubs.list_type` / `public.saved_lists.name`
--     text, not a separate list id, because custom lists already live at that
--     seam.
--   • Reads are public because authored saved lists are shareable public content;
--     writes remain service-role-only through the app's API route.
--
-- RLS / ownership honesty:
-- Auth is not fully enabled for this social surface yet. The app still resolves
-- self-asserted handles to `public.profiles.id`, so a durable edge is only as
-- strong as the current handle-scoped demo ownership model. When Supabase Auth
-- is enabled end-to-end, add user-owned write policies keyed through
-- profiles.user_id / auth.uid(); until then, do NOT add anon/authenticated write
-- policies here.

create extension if not exists "pgcrypto";

create table if not exists public.saved_list_follows (
  id uuid primary key default gen_random_uuid(),
  follower_profile_id uuid not null references public.profiles (id) on delete cascade,
  list_owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  list_name text not null,
  created_at timestamptz not null default now(),
  unique (follower_profile_id, list_owner_profile_id, list_name)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'saved_list_follows_no_self_chk'
  ) then
    alter table public.saved_list_follows
      add constraint saved_list_follows_no_self_chk
      check (follower_profile_id <> list_owner_profile_id);
  end if;
end $$;

create index if not exists saved_list_follows_follower_idx
  on public.saved_list_follows (follower_profile_id, created_at desc);

create index if not exists saved_list_follows_owner_list_idx
  on public.saved_list_follows (list_owner_profile_id, list_name, created_at desc);

alter table public.saved_list_follows enable row level security;

-- Public read mirrors saved_pubs_public_read / saved_lists_public_read: a
-- followable list is authored public content plus aggregate social signal.
-- There is intentionally no anon/authenticated write policy; the server writes
-- via service role after rate limiting and handle normalization.
drop policy if exists saved_list_follows_public_read on public.saved_list_follows;
create policy saved_list_follows_public_read
  on public.saved_list_follows
  for select
  using (true);
