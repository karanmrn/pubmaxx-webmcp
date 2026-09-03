-- Manual rollback for 0113. This restores the effective ACL state found
-- before the repair. It reopens SECURITY DEFINER functions to browser roles,
-- so use it only to diagnose or reverse 0113 under captain supervision.

grant execute on function public.claim_social_post_moderation_jobs(integer)
  to public, anon, authenticated;
grant execute on function public.read_social_crew_snapshot(uuid, uuid, uuid)
  to public, anon, authenticated;
