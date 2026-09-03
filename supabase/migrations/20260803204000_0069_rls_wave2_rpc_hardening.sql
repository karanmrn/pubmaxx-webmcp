-- RLS wave 2: close anon EXECUTE on the community-price quality refresher.
--
-- refresh_community_price_quality() is SECURITY DEFINER and mutates
-- community_prices quality stamps. Postgres grants EXECUTE to PUBLIC by
-- default on new functions, so any anonymous PostgREST caller could pull the
-- lever at /rest/v1/rpc/refresh_community_price_quality. It is a trigger body,
-- not a product RPC — revoke every client role.
--
-- public_contributor_leaderboard() is intentionally left as the prior
-- migration left it (service_role execute after revoke from public). If a
-- live environment still shows anon EXECUTE, that is a ledger drift to fix
-- out-of-band; this file does not re-open it to anon.
--
-- Reverse: grant execute on refresh_community_price_quality() to the roles
-- that previously held it (not recommended).

begin;

revoke all on function public.refresh_community_price_quality()
  from public, anon, authenticated;

-- Trigger functions need to run as the table owner / definer; service_role
-- and the table owner path keep execute. Authenticated clients never call it.
grant execute on function public.refresh_community_price_quality()
  to service_role;

-- Defence in depth: re-assert leaderboard is not a public write surface.
-- SELECT-style SECURITY DEFINER read stays service_role only (API DTO path).
revoke all on function public.public_contributor_leaderboard()
  from public, anon, authenticated;
grant execute on function public.public_contributor_leaderboard()
  to service_role;

commit;
