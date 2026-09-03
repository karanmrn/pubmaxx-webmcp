-- Restore service-only access after later CREATE OR REPLACE statements
-- widened the effective ACLs of two SECURITY DEFINER Social functions.

revoke all on function public.claim_social_post_moderation_jobs(integer)
  from public, anon, authenticated;
revoke all on function public.read_social_crew_snapshot(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_social_post_moderation_jobs(integer)
  to service_role;
grant execute on function public.read_social_crew_snapshot(uuid, uuid, uuid)
  to service_role;
