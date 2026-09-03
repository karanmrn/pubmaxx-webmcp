-- Durable verified-adult Social posts. All browser access goes through API
-- routes using the Task 2 actor seam. Browser database roles receive no table
-- or function privileges.

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references public.profiles(id) on delete restrict,
  author_handle text not null,
  kind text not null check (kind in ('standard', 'feature_request')),
  visibility text not null check (visibility in ('public', 'friends', 'private')),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  body text not null default '' check (char_length(body) <= 2000),
  area_slug text check (area_slug in (
    'clapham', 'victoria', 'piccadilly-soho', 'canary-wharf', 'barnes',
    'chiswick', 'shoreditch', 'camden', 'brixton',
    'bermondsey-london-bridge', 'kings-cross', 'islington', 'dalston',
    'peckham', 'greenwich', 'hammersmith', 'balham', 'marylebone',
    'richmond', 'putney'
  )),
  venue_id text check (venue_id is null or char_length(venue_id) between 1 and 100),
  hashtags text[] not null default '{}'::text[],
  comment_policy text not null check (comment_policy in ('open', 'friends', 'locked')),
  photo_media_id uuid,
  photo_alt_text text check (photo_alt_text is null or char_length(photo_alt_text) between 1 and 300),
  feature_status text check (feature_status in ('submitted', 'planned', 'shipped', 'declined')),
  feature_staff_response text check (
    feature_staff_response is null or char_length(feature_staff_response) <= 2000
  ),
  moderation_state text not null default 'pending'
    check (moderation_state in ('pending', 'approved', 'needs_review')),
  revision integer not null default 0 check (revision >= 0),
  mutation_version integer not null default 0 check (mutation_version >= 0),
  edited_at timestamptz,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_posts_content_check check (body <> '' or photo_media_id is not null),
  constraint social_posts_photo_alt_check check (
    (photo_media_id is null and photo_alt_text is null)
    or (photo_media_id is not null and photo_alt_text is not null)
  ),
  constraint social_posts_feature_body_check check (kind <> 'feature_request' or body <> ''),
  constraint social_posts_feature_metadata_check check (
    (kind = 'feature_request' and feature_status is not null)
    or (kind = 'standard' and feature_status is null and feature_staff_response is null)
  ),
  constraint social_posts_public_venue_check check (visibility <> 'public' or venue_id is null),
  constraint social_posts_hashtag_count_check check (cardinality(hashtags) <= 10)
);

create index social_posts_feed_idx
  on public.social_posts (created_at desc, id desc)
  where status = 'visible' and moderation_state = 'approved';
create index social_posts_area_feed_idx
  on public.social_posts (area_slug, created_at desc, id desc)
  where status = 'visible' and moderation_state = 'approved' and visibility = 'public';
create index social_posts_author_feed_idx
  on public.social_posts (author_profile_id, created_at desc, id desc);

create table public.social_post_moderation_jobs (
  post_id uuid primary key references public.social_posts(id) on delete cascade,
  revision integer not null check (revision >= 0),
  moderation_claim text not null,
  state text not null default 'pending' check (state in ('pending', 'processing', 'done', 'error')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_post_moderation_jobs_claim_idx
  on public.social_post_moderation_jobs (next_attempt_at, created_at)
  where state in ('pending', 'processing');

create function public.queue_social_post_moderation()
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
      state = 'pending',
      revision = excluded.revision,
      moderation_claim = excluded.moderation_claim,
      attempts = 0,
      next_attempt_at = now(),
      lease_until = null,
      last_error_code = null,
      updated_at = now();
  end if;
  return new;
end;
$$;

create trigger social_posts_queue_moderation_insert
after insert on public.social_posts
for each row execute function public.queue_social_post_moderation();

create trigger social_posts_queue_moderation_update
after update of revision on public.social_posts
for each row
when (old.revision is distinct from new.revision)
execute function public.queue_social_post_moderation();

create function public.social_post_readable(
  p_post public.social_posts,
  p_viewer_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_post.status = 'visible'
    and p_post.moderation_state = 'approved'
    and (
      p_post.author_profile_id = p_viewer_profile_id
      or p_post.visibility = 'public'
      or (
        p_post.visibility = 'friends'
        and exists (
          select 1 from public.follows
          where follower_id = p_viewer_profile_id
            and followee_id = p_post.author_profile_id
        )
        and exists (
          select 1 from public.follows
          where follower_id = p_post.author_profile_id
            and followee_id = p_viewer_profile_id
        )
      )
    );
$$;

create function public.read_social_post(
  p_post_id uuid,
  p_viewer_profile_id uuid
)
returns setof public.social_posts
language sql
stable
security definer
set search_path = public
as $$
  select post.*
  from public.social_posts post
  where post.id = p_post_id
    and public.social_post_readable(post, p_viewer_profile_id);
$$;

create function public.read_social_post_feed(
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
  if p_lane not in ('discover', 'nearby', 'following')
    or p_limit < 1 or p_limit > 51
    or (p_lane = 'nearby' and p_area_slug is null)
    or ((p_before_created_at is null) <> (p_before_id is null))
  then
    raise exception 'invalid social feed request';
  end if;

  return query
  select post.*
  from public.social_posts post
  where public.social_post_readable(post, p_viewer_profile_id)
    and (
      p_before_created_at is null
      or (post.created_at, post.id) < (p_before_created_at, p_before_id)
    )
    and case p_lane
      when 'discover' then post.visibility = 'public'
      when 'nearby' then post.visibility = 'public' and post.area_slug = p_area_slug
      when 'following' then
        exists (
          select 1 from public.follows
          where follower_id = p_viewer_profile_id
            and followee_id = post.author_profile_id
        )
        and (
          post.visibility = 'public'
          or (
            post.visibility = 'friends'
            and exists (
              select 1 from public.follows
              where follower_id = post.author_profile_id
                and followee_id = p_viewer_profile_id
            )
          )
        )
      else false
    end
  order by post.created_at desc, post.id desc
  limit p_limit;
end;
$$;

create function public.edit_social_post(
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
returns table(post_id uuid, revision integer, moderation_claim text, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception 'invalid moderation batch size';
  end if;
  return query
  with candidates as (
    select job.post_id
    from public.social_post_moderation_jobs job
    join public.social_posts post on post.id = job.post_id
    where post.moderation_state = 'pending'
      and (
        (job.state = 'pending' and job.next_attempt_at <= now())
        or (job.state = 'processing' and job.lease_until < now())
      )
    order by job.next_attempt_at, job.created_at
    for update of job skip locked
    limit p_limit
  ), claimed as (
    update public.social_post_moderation_jobs job
    set state = 'processing',
        attempts = job.attempts + 1,
        lease_until = now() + interval '5 minutes',
        updated_at = now()
    from candidates
    where job.post_id = candidates.post_id
    returning job.post_id, job.revision, job.attempts
  )
  select claimed.post_id, claimed.revision, job.moderation_claim, claimed.attempts
  from claimed
  join public.social_post_moderation_jobs job on job.post_id = claimed.post_id;
end;
$$;

create function public.complete_social_post_moderation_job(
  p_post_id uuid,
  p_revision integer,
  p_decision text default null,
  p_error_code text default null,
  p_retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision in ('approved', 'needs_review') then
    update public.social_posts
    set moderation_state = p_decision,
        moderated_at = now(),
        updated_at = now()
    where id = p_post_id and revision = p_revision and moderation_state = 'pending';
    if not found then
      return false;
    end if;
    update public.social_post_moderation_jobs
    set state = 'done', lease_until = null, last_error_code = null, updated_at = now()
    where post_id = p_post_id and revision = p_revision and state = 'processing';
    return found;
  end if;
  if p_decision is not null then
    raise exception 'invalid moderation decision';
  end if;
  update public.social_post_moderation_jobs
  set state = case when p_retry_at is null then 'error' else 'pending' end,
      next_attempt_at = coalesce(p_retry_at, next_attempt_at),
      lease_until = null,
      last_error_code = left(coalesce(p_error_code, 'provider_error'), 80),
      updated_at = now()
  where post_id = p_post_id and revision = p_revision and state = 'processing';
  return found;
end;
$$;

create function public.requeue_social_post_moderation_errors(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  requeued_count integer;
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception 'invalid moderation requeue batch size';
  end if;
  with candidates as (
    select job.post_id
    from public.social_post_moderation_jobs job
    join public.social_posts post on post.id = job.post_id
    where job.state = 'error'
      and post.moderation_state = 'pending'
    order by job.updated_at, job.created_at
    for update of job skip locked
    limit p_limit
  ), requeued as (
    update public.social_post_moderation_jobs job
    set state = 'pending',
        attempts = 0,
        next_attempt_at = now(),
        lease_until = null,
        last_error_code = null,
        updated_at = now()
    from candidates
    where job.post_id = candidates.post_id
    returning job.post_id
  )
  select count(*)::integer into requeued_count from requeued;
  return requeued_count;
end;
$$;

alter table public.social_posts enable row level security;
alter table public.social_post_moderation_jobs enable row level security;

revoke all on public.social_posts from public, anon, authenticated;
revoke all on public.social_post_moderation_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.social_posts to service_role;
grant select, insert, update, delete on public.social_post_moderation_jobs to service_role;

revoke all on function public.queue_social_post_moderation() from public, anon, authenticated;
revoke all on function public.social_post_readable(public.social_posts, uuid) from public, anon, authenticated;
revoke all on function public.read_social_post(uuid, uuid) from public, anon, authenticated;
revoke all on function public.read_social_post_feed(uuid, text, text, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.edit_social_post(
  uuid, uuid, integer, text, text, text, text, text, text[], text, uuid, text, boolean
) from public, anon, authenticated;
revoke all on function public.claim_social_post_moderation_jobs(integer)
  from public, anon, authenticated;
revoke all on function public.complete_social_post_moderation_job(uuid, integer, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.requeue_social_post_moderation_errors(integer)
  from public, anon, authenticated;

grant execute on function public.social_post_readable(public.social_posts, uuid) to service_role;
grant execute on function public.read_social_post(uuid, uuid) to service_role;
grant execute on function public.read_social_post_feed(uuid, text, text, timestamptz, uuid, integer)
  to service_role;
grant execute on function public.edit_social_post(
  uuid, uuid, integer, text, text, text, text, text, text[], text, uuid, text, boolean
) to service_role;
grant execute on function public.claim_social_post_moderation_jobs(integer) to service_role;
grant execute on function public.complete_social_post_moderation_job(uuid, integer, text, text, timestamptz)
  to service_role;
grant execute on function public.requeue_social_post_moderation_errors(integer) to service_role;
