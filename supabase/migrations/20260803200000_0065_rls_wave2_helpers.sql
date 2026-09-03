-- RLS wave 2 helpers.
--
-- App writes still go through the service-role admin client (lib/supabase.ts),
-- which bypasses RLS. These helpers + the policies in 0066–0068 are the second
-- line of defence for any future path that uses the caller's JWT (Clerk /
-- authenticated PostgREST). They mirror the ownership rules already enforced
-- at the API seams (lib/profileOwnership.ts, resolveContributionIdentity,
-- plan member tokens, message participant checks).
--
-- Helpers are SECURITY DEFINER so a policy on table A can look up profiles /
-- plan membership without recursing into RLS on those tables. They always
-- read auth.uid() from the calling session, never a parameter that a client
-- could forge as "someone else's uid".
--
-- Reverse: drop function public.rls_* cascade (policies that call them must
-- go first — see 0066–0068 drop policy blocks).

begin;

-- Profile id for the current JWT, or null when unlinked / anonymous.
create or replace function public.rls_current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.user_id = (select auth.uid())
  limit 1;
$$;

-- True when auth.uid() owns this profiles.id row.
create or replace function public.rls_owns_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile_id is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = p_profile_id
        and p.user_id = (select auth.uid())
    );
$$;

-- True when auth.uid() owns the profile that currently claims this handle
-- (or an alias that points at that profile).
create or replace function public.rls_owns_handle(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_handle is not null
    and length(btrim(p_handle)) > 0
    and exists (
      select 1
      from public.profiles p
      where p.user_id = (select auth.uid())
        and (
          lower(p.handle) = lower(btrim(p_handle))
          or exists (
            select 1
            from public.profile_handle_aliases a
            where a.profile_id = p.id
              and lower(a.handle) = lower(btrim(p_handle))
          )
        )
    );
$$;

-- Plan owner or a crew row already linked to this auth user.
-- Member-token capability stays API-only (token_hash is never granted to
-- browser roles); this helper only covers account-linked membership.
create or replace function public.rls_is_plan_participant(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_plan_id is not null
    and (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.plans pl
        where pl.id = p_plan_id
          and pl.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.plan_crew_members m
        where m.plan_id = p_plan_id
          and m.user_id = (select auth.uid())
      )
    );
$$;

-- Conversation participant via reserved user_id columns OR linked handle.
create or replace function public.rls_is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_conversation_id is not null
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.conversations c
      where c.id = p_conversation_id
        and (
          c.user_id_a = (select auth.uid())
          or c.user_id_b = (select auth.uid())
          or public.rls_owns_handle(c.handle_a)
          or public.rls_owns_handle(c.handle_b)
        )
    );
$$;

-- Community-price actor token for the current linked profile
-- (lib/contributionIdentity.server.ts: `profile:${profile.id}`).
create or replace function public.rls_current_price_actor()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.rls_current_profile_id() is null then null
    else 'profile:' || public.rls_current_profile_id()::text
  end;
$$;

-- True when the caller's linked profile follows the profile that currently
-- claims p_handle (or an alias that points at that profile).
-- Mirrors qualifiesForFriends in lib/pintDrops.ts: a friends-only Pint Drop is
-- visible to the AUTHOR'S FOLLOWERS (viewer follows author), not mutual-only
-- and not "people the author follows".
create or replace function public.rls_follows_handle(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_handle is not null
    and length(btrim(p_handle)) > 0
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.follows f
      join public.profiles me
        on me.id = f.follower_id
       and me.user_id = (select auth.uid())
      join public.profiles author
        on author.id = f.followee_id
      where (
          lower(author.handle) = lower(btrim(p_handle))
          or exists (
            select 1
            from public.profile_handle_aliases a
            where a.profile_id = author.id
              and lower(a.handle) = lower(btrim(p_handle))
          )
        )
    );
$$;

-- Pint Drop / visit_reports public-surface gate.
-- Matches canViewOnPublicSurface + status filter in lib/pintDrops.ts and
-- getPintDropById: only status='visible' rows leave the API boundary, and
-- friends/legacy lanes stay gated. Hidden and pending never read through
-- PostgREST (including for the author) — the service-role store owns those.
create or replace function public.rls_can_read_visit_report(
  p_status text,
  p_visibility text,
  p_handle text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_status = 'visible'
    and (
      coalesce(nullif(btrim(p_visibility), ''), 'public') in ('public', 'anonymous')
      or public.rls_owns_handle(p_handle)
      or (
        coalesce(nullif(btrim(p_visibility), ''), 'public') = 'friends'
        and public.rls_follows_handle(p_handle)
      )
    );
$$;

revoke all on function public.rls_current_profile_id() from public, anon;
revoke all on function public.rls_owns_profile(uuid) from public, anon;
revoke all on function public.rls_owns_handle(text) from public, anon;
revoke all on function public.rls_is_plan_participant(uuid) from public, anon;
revoke all on function public.rls_is_conversation_participant(uuid) from public, anon;
revoke all on function public.rls_current_price_actor() from public, anon;
revoke all on function public.rls_follows_handle(text) from public, anon;
revoke all on function public.rls_can_read_visit_report(text, text, text) from public, anon;

grant execute on function public.rls_current_profile_id() to authenticated, service_role;
grant execute on function public.rls_owns_profile(uuid) to authenticated, service_role;
grant execute on function public.rls_owns_handle(text) to authenticated, service_role;
grant execute on function public.rls_is_plan_participant(uuid) to authenticated, service_role;
grant execute on function public.rls_is_conversation_participant(uuid) to authenticated, service_role;
grant execute on function public.rls_current_price_actor() to authenticated, service_role;
grant execute on function public.rls_follows_handle(text) to authenticated, service_role;
grant execute on function public.rls_can_read_visit_report(text, text, text) to authenticated, service_role;

commit;
