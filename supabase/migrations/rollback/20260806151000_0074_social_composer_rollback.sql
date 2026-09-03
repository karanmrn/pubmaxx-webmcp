-- Restore Task 3/4 Social post shape. Task 6 private media and consent rows are
-- removed. Existing posts remain, with Task 6-only Venue/photo fields cleared.

grant execute on function public.set_social_comment_policy(uuid,uuid,text) to service_role;

delete from public.social_notifications where kind = 'tag_proposal';
alter table public.social_notifications drop constraint social_notifications_kind_check;
alter table public.social_notifications add constraint social_notifications_kind_check
  check (kind in ('cheer', 'comment', 'repost', 'quote', 'feature_update'));

drop function if exists public.moderate_social_post(uuid,uuid,uuid,text);
drop function if exists public.read_social_post_moderation_queue(uuid,integer);
drop function if exists public.read_social_post_outbox(uuid,timestamptz,uuid,integer);
drop function if exists public.read_social_post_outbox_item(uuid,uuid);
drop function if exists public.read_social_post_media(uuid,uuid);
drop function if exists public.read_social_tag_inbox(uuid,text,timestamptz,uuid,integer);
drop function if exists public.read_social_post_tags(uuid,uuid);
drop function if exists public.read_social_post_tags_many(uuid,uuid[]);
drop function if exists public.act_social_post_tag(uuid,uuid,text,integer);
drop function if exists public.remove_social_post_idempotent(uuid,uuid,integer,text);
drop function if exists public.edit_social_post_with_media(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean,text,text,integer,integer,integer,text[]);
drop function if exists public.create_social_post_idempotent(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[],text,text);
drop function if exists public.create_social_post(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[]);
drop function if exists public.social_post_exact_venue_allowed(public.social_posts,uuid);
drop function if exists public.reserve_social_post_media_upload(uuid,uuid,text,integer,integer,integer);
drop function if exists public.claim_social_post_media_upload_cleanup(uuid,uuid,uuid);
drop function if exists public.claim_social_post_media_upload_cleanup_batch(integer,timestamptz);
drop function if exists public.finalize_social_post_media_upload_cleanup(uuid,uuid,uuid);
drop function if exists public.claim_social_post_media_cleanup_batch(integer);
drop function if exists public.finalize_social_post_media_cleanup(uuid,uuid,uuid);
drop function if exists public.social_post_digest(public.social_posts);

drop trigger if exists social_post_tag_proposal_guard on public.social_post_tag_proposals;
drop function if exists public.guard_social_post_tag_proposal();
drop trigger if exists social_posts_photo_owner_guard on public.social_posts;
drop function if exists public.guard_social_post_photo_owner();

drop function public.complete_social_post_moderation_job(uuid,integer,uuid,uuid,text,text,timestamptz);
drop function public.claim_social_post_moderation_jobs(integer);

update public.social_posts set
  venue_id = case when visibility = 'public' then null else venue_id end,
  photo_media_id = null,
  photo_alt_text = null
where (visibility = 'public' and venue_id is not null) or photo_media_id is not null;

alter table public.social_posts drop constraint social_posts_photo_media_fk;
drop index public.social_posts_one_media_attachment_idx;
alter table public.social_post_moderation_jobs drop column media_id, drop column lease_token;

drop table public.social_post_moderation_actions;
drop table public.social_post_tag_events;
drop table public.social_post_tag_proposals;
drop table public.social_post_media_lifecycle_events;
drop table public.social_post_edit_audit;
drop table public.social_post_create_requests;
drop table public.social_post_remove_requests;
drop table public.social_post_media;
drop table public.social_post_media_uploads;
drop function public.reject_social_append_only_change();

alter table public.social_posts add constraint social_posts_public_venue_check
  check (visibility <> 'public' or venue_id is null);

create or replace function public.queue_social_post_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.moderation_state = 'pending' then
    insert into public.social_post_moderation_jobs(post_id, revision, moderation_claim)
    values (
      new.id,
      new.revision,
      new.body || case
        when cardinality(new.hashtags) > 0
          then E'\n\n#' || array_to_string(new.hashtags, ' #')
        else ''
      end
    )
    on conflict (post_id) do update set
      state = 'pending', revision = excluded.revision,
      moderation_claim = excluded.moderation_claim, attempts = 0,
      next_attempt_at = now(), lease_until = null, last_error_code = null,
      updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.read_social_post(p_post_id uuid,p_viewer_profile_id uuid)
returns setof public.social_posts
language sql
stable
security definer
set search_path = public
as $$
  select post.* from public.social_posts post
  where post.id=p_post_id and public.social_post_readable(post,p_viewer_profile_id)
    and not public.social_interaction_blocked(p_viewer_profile_id,post.author_profile_id);
$$;

create or replace function public.read_social_post_feed(
  p_viewer_profile_id uuid,
  p_lane text,
  p_area_slug text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns setof public.social_posts
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_lane not in ('discover','nearby','following') or p_limit<1 or p_limit>51
    or (p_lane='nearby' and p_area_slug is null)
    or ((p_before_created_at is null) <> (p_before_id is null))
  then raise exception 'invalid social feed request'; end if;
  return query select post.* from public.social_posts post
  where public.social_post_readable(post,p_viewer_profile_id)
    and not public.social_interaction_blocked(p_viewer_profile_id,post.author_profile_id)
    and (p_before_created_at is null or (post.created_at,post.id)<(p_before_created_at,p_before_id))
    and case p_lane
      when 'discover' then post.visibility='public'
      when 'nearby' then post.visibility='public' and post.area_slug=p_area_slug
      when 'following' then
        exists (select 1 from public.follows where follower_id=p_viewer_profile_id and followee_id=post.author_profile_id)
        and (post.visibility='public' or (post.visibility='friends' and exists (
          select 1 from public.follows where follower_id=post.author_profile_id and followee_id=p_viewer_profile_id
        )))
      else false end
  order by post.created_at desc,post.id desc limit p_limit;
end;
$$;

create or replace function public.edit_social_post(
  p_post_id uuid,
  p_author_profile_id uuid,
  p_expected_mutation_version integer,
  p_kind text,
  p_visibility text,
  p_body text,
  p_area_slug text,
  p_venue_id text,
  p_hashtags text[],
  p_comment_policy text,
  p_photo_media_id uuid,
  p_photo_alt_text text,
  p_content_changed boolean
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.social_posts post
  set kind = p_kind,
      visibility = p_visibility,
      body = p_body,
      area_slug = p_area_slug,
      venue_id = p_venue_id,
      hashtags = p_hashtags,
      comment_policy = p_comment_policy,
      photo_media_id = p_photo_media_id,
      photo_alt_text = p_photo_alt_text,
      feature_status = case
        when p_kind = 'feature_request' then coalesce(post.feature_status, 'submitted')
        else null
      end,
      feature_staff_response = case
        when p_kind = 'feature_request' then post.feature_staff_response
        else null
      end,
      revision = post.revision + case when p_content_changed then 1 else 0 end,
      mutation_version = post.mutation_version + 1,
      edited_at = case when p_content_changed then now() else post.edited_at end,
      moderation_state = case when p_content_changed then 'pending' else post.moderation_state end,
      moderated_at = case when p_content_changed then null else post.moderated_at end,
      updated_at = now()
  where post.id = p_post_id
    and post.author_profile_id = p_author_profile_id
    and post.status = 'visible'
    and post.mutation_version = p_expected_mutation_version
  returning post.*;
end;
$$;

create function public.claim_social_post_moderation_jobs(p_limit integer default 20)
returns table(post_id uuid,revision integer,moderation_claim text,attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit<1 or p_limit>50 then raise exception 'invalid moderation batch size'; end if;
  return query with candidates as (
    select job.post_id from public.social_post_moderation_jobs job
    join public.social_posts post on post.id=job.post_id
    where post.moderation_state='pending' and (
      (job.state='pending' and job.next_attempt_at<=now())
      or (job.state='processing' and job.lease_until<now())
    ) order by job.next_attempt_at,job.created_at for update of job skip locked limit p_limit
  ), claimed as (
    update public.social_post_moderation_jobs job set state='processing',attempts=job.attempts+1,
      lease_until=now()+interval '5 minutes',updated_at=now()
    from candidates where job.post_id=candidates.post_id
    returning job.post_id,job.revision,job.attempts
  ) select claimed.post_id,claimed.revision,job.moderation_claim,claimed.attempts
  from claimed join public.social_post_moderation_jobs job on job.post_id=claimed.post_id;
end;
$$;

create function public.complete_social_post_moderation_job(
  p_post_id uuid,p_revision integer,p_decision text default null,
  p_error_code text default null,p_retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision in ('approved','needs_review') then
    update public.social_posts set moderation_state=p_decision,moderated_at=now(),updated_at=now()
    where id=p_post_id and revision=p_revision and moderation_state='pending';
    if not found then return false; end if;
    update public.social_post_moderation_jobs set state='done',lease_until=null,last_error_code=null,updated_at=now()
    where post_id=p_post_id and revision=p_revision and state='processing';
    return found;
  end if;
  if p_decision is not null then raise exception 'invalid moderation decision'; end if;
  update public.social_post_moderation_jobs set
    state=case when p_retry_at is null then 'error' else 'pending' end,
    next_attempt_at=coalesce(p_retry_at,next_attempt_at),lease_until=null,
    last_error_code=left(coalesce(p_error_code,'provider_error'),80),updated_at=now()
  where post_id=p_post_id and revision=p_revision and state='processing';
  return found;
end;
$$;

revoke all on function public.queue_social_post_moderation() from public,anon,authenticated;
revoke all on function public.read_social_post(uuid,uuid) from public,anon,authenticated;
revoke all on function public.read_social_post_feed(uuid,text,text,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.edit_social_post(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.claim_social_post_moderation_jobs(integer) from public,anon,authenticated;
revoke all on function public.complete_social_post_moderation_job(uuid,integer,text,text,timestamptz) from public,anon,authenticated;

grant execute on function public.read_social_post(uuid,uuid),
  public.read_social_post_feed(uuid,text,text,timestamptz,uuid,integer),
  public.edit_social_post(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean),
  public.claim_social_post_moderation_jobs(integer),
  public.complete_social_post_moderation_job(uuid,integer,text,text,timestamptz)
  to service_role;
