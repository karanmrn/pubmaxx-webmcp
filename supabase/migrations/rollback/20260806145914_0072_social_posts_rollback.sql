drop function if exists public.requeue_social_post_moderation_errors(integer);
drop function if exists public.complete_social_post_moderation_job(uuid, integer, text, text, timestamptz);
drop function if exists public.claim_social_post_moderation_jobs(integer);
drop function if exists public.edit_social_post(
  uuid, uuid, integer, text, text, text, text, text, text[], text, uuid, text, boolean
);
drop function if exists public.read_social_post_feed(uuid, text, text, timestamptz, uuid, integer);
drop function if exists public.read_social_post(uuid, uuid);
drop function if exists public.social_post_readable(public.social_posts, uuid);
drop trigger if exists social_posts_queue_moderation_update on public.social_posts;
drop trigger if exists social_posts_queue_moderation_insert on public.social_posts;
drop function if exists public.queue_social_post_moderation();
drop table if exists public.social_post_moderation_jobs;
drop table if exists public.social_posts;
