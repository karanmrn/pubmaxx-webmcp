-- 0085: revoke browser-role EXECUTE on SECURITY DEFINER moderation functions.
-- Supabase advisor WARN: anon can execute SECURITY DEFINER functions.
-- Both functions are called only through the service role
-- (requireSupabaseAdmin in lib/socialPostStore.ts and lib/socialCrewStore.ts),
-- which bypasses grants, so app behaviour is unchanged.
-- SQL only - the captain applies migrations.

revoke execute on function public.claim_social_post_moderation_jobs(integer) from anon, authenticated;
revoke execute on function public.read_social_crew_snapshot(uuid, uuid, uuid) from anon, authenticated;
