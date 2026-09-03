-- Auth ownership for profiles: link a real Supabase Auth user to a profile via
-- profiles.user_id, and tighten RLS so that ONCE a handle is claimed by a user,
-- only that user may write its row through an authenticated (JWT) path. Apply
-- AFTER 0006. Idempotent + re-runnable in the 0001/0006 house style.
--
-- ── The enforcement model in THIS codebase ──────────────────────────────────
-- Every server write in the app routes through the SERVICE-ROLE admin client
-- (lib/supabase.ts getSupabaseAdmin), which BYPASSES RLS. So RLS alone cannot be
-- the security boundary for the app's own writes — the real gate is a
-- server-side ownership check at the API seam (app/api/profiles/[handle]/route.ts):
--   • The client attaches its Supabase access token (Authorization: Bearer …).
--   • The server verifies it (auth.getUser(jwt)) to obtain a trusted auth.uid().
--   • On any write it links the caller's handle → user_id (first authed touch),
--     and REJECTS a write to a handle already linked to a DIFFERENT user_id.
--   • No token / no session → the anonymous demo path stands: an UNLINKED handle
--     is still self-asserted-editable (demo-friendly); a LINKED handle is not.
--
-- The RLS policies below are the SECOND line of defence: they make the intent
-- explicit and they bite if a future path ever writes with the user's own JWT
-- (anon/authenticated role) instead of the service role. They never loosen the
-- current posture — writes remain service-role-only for anon roles.

-- ── Foreign key: profiles.user_id → auth.users(id) ──────────────────────────
-- Now that auth is arriving, promote the reserved nullable column to a real FK.
-- ON DELETE SET NULL so deleting an auth user orphans (not deletes) the profile,
-- preserving its public handle + contributions. Guarded so re-runs are safe and
-- so this migration still applies on a project where auth.users happens to be
-- empty (the constraint validates fine against a nullable, unset column).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_user_fk') then
    alter table public.profiles
      add constraint profiles_user_fk
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;
end $$;

-- One auth user maps to at most one profile. Partial unique index (WHERE user_id
-- is not null) so the many unlinked demo rows — all user_id null — don't collide.
create unique index if not exists profiles_user_id_unique
  on public.profiles (user_id)
  where user_id is not null;

-- ── RLS ownership policies (second line of defence; see header) ──────────────
-- profiles already has profiles_public_read (0006) and NO anon/authenticated
-- write policy, so anon-role writes are denied and the service role bypasses
-- RLS. We ADD authenticated-role ownership policies so that IF a write is ever
-- issued with the user's own JWT, it is allowed ONLY on the row they own.
--
-- These do not affect the service-role path (it bypasses RLS entirely) and do
-- not grant anon writes — an unauthenticated client still cannot write here.

-- A signed-in user may UPDATE only the profile row linked to their auth.uid().
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update
  on public.profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A signed-in user may INSERT a profile row only when it is linked to themselves
-- (or left unlinked for the server to link) — never one pre-claimed by another
-- user. Belt-and-braces: the app inserts via the service role, but this makes an
-- authenticated-JWT insert safe too.
drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert
  on public.profiles
  for insert
  to authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- ── Account migration note (user story 32) ──────────────────────────────────
-- There is NO separate re-attribution to do here. All pre-auth activity is
-- keyed by the public `handle`, not by a user id:
--   • pint drops (visit_reports.handle), profiles.handle, follows (via profile
--     handle), saved_pubs (via profile_id → profiles.handle), crawl authorship.
-- So "migrating" a device's prior activity onto a new account is exactly one
-- operation: stamp profiles.user_id on that handle's existing row. Every drop /
-- save / follow already hangs off the handle and is therefore claimed the moment
-- the profile row is linked. No data is copied or moved. See profileStore.linkUser
-- + app/api/profiles/[handle]/route.ts for the server-side link on first sign-in.
