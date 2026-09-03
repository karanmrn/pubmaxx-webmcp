create table public.social_blocks (
  blocker_profile_id uuid not null references public.profiles(id) on delete cascade,
  blocked_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_profile_id, blocked_profile_id),
  check (blocker_profile_id <> blocked_profile_id)
);

create table public.social_cheers (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, actor_profile_id)
);

create table public.social_saves (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, actor_profile_id)
);

create table public.social_reposts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_handle text not null check (char_length(actor_handle) between 1 and 30),
  created_at timestamptz not null default now(),
  unique (post_id, actor_profile_id)
);

create table public.social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  author_handle text not null check (char_length(author_handle) between 1 and 30),
  body text not null check (char_length(body) between 1 and 1000),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  moderation_state text not null default 'pending' check (moderation_state in ('pending', 'approved', 'needs_review')),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_profile_id, idempotency_key_hash)
);
create index social_comments_post_page_idx on public.social_comments(post_id, created_at desc, id desc);

create table public.social_quotes (
  id uuid primary key default gen_random_uuid(),
  source_post_id uuid not null references public.social_posts(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  author_handle text not null check (char_length(author_handle) between 1 and 30),
  body text not null check (char_length(body) between 1 and 2000),
  visibility text not null check (visibility in ('public', 'friends', 'private')),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  moderation_state text not null default 'pending' check (moderation_state in ('pending', 'approved', 'needs_review')),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_profile_id, idempotency_key_hash)
);
create index social_quotes_page_idx on public.social_quotes(created_at desc, id desc);

create table public.social_interaction_moderation_jobs (
  content_kind text not null check (content_kind in ('comment', 'quote')),
  content_id uuid not null,
  moderation_claim text not null check (char_length(moderation_claim) between 1 and 2000),
  state text not null default 'pending' check (state in ('pending', 'leased', 'error')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (content_kind, content_id)
);
create index social_interaction_moderation_pending_idx
  on public.social_interaction_moderation_jobs(state, next_attempt_at, created_at);

create table public.private_social_staff_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  role text not null check (role in ('moderator', 'product_staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.social_feature_request_updates (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  staff_role_id uuid not null references public.private_social_staff_roles(id),
  status text not null check (status in ('planned', 'shipped', 'declined')),
  response text not null check (char_length(response) between 1 and 2000),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (staff_role_id, idempotency_key_hash)
);
create index social_feature_updates_page_idx on public.social_feature_request_updates(post_id, created_at, id);

create table public.social_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('cheer', 'comment', 'repost', 'quote', 'feature_update')),
  source_post_id uuid not null references public.social_posts(id) on delete cascade,
  source_content_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (recipient_profile_id, actor_profile_id, kind, source_post_id, source_content_id)
);
create index social_notifications_recipient_page_idx on public.social_notifications(recipient_profile_id, created_at desc, id desc);

create table public.social_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_profile_id uuid not null references public.profiles(id) on delete cascade,
  content_kind text not null check (content_kind in ('post', 'comment', 'quote')),
  content_id uuid not null,
  reason text not null check (reason in ('harassment', 'hate', 'threat', 'doxxing', 'spam', 'other')),
  state text not null default 'queued' check (state in ('queued', 'reviewing', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_staff_role_id uuid references public.private_social_staff_roles(id),
  unique (reporter_profile_id, content_kind, content_id, reason)
);

create table public.social_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  staff_role_id uuid not null references public.private_social_staff_roles(id),
  content_kind text not null check (content_kind in ('comment', 'quote')),
  content_id uuid not null,
  action text not null check (action in ('hide', 'restore')),
  created_at timestamptz not null default now()
);

create function public.social_interaction_blocked(p_first uuid, p_second uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.social_blocks
    where (blocker_profile_id = p_first and blocked_profile_id = p_second)
       or (blocker_profile_id = p_second and blocked_profile_id = p_first)
  );
$$;

create function public.set_social_block(p_actor uuid, p_target uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_actor = p_target then raise exception 'cannot block self'; end if;
  if p_active then
    insert into public.social_blocks(blocker_profile_id, blocked_profile_id)
    values (p_actor, p_target) on conflict do nothing;
  else
    delete from public.social_blocks where blocker_profile_id = p_actor and blocked_profile_id = p_target;
  end if;
  return true;
end;
$$;

create function public.set_social_desired_interaction(
  p_actor uuid,
  p_post_id uuid,
  p_kind text,
  p_active boolean,
  p_actor_handle text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts;
begin
  select * into v_post from public.social_posts where id = p_post_id for share;
  if v_post.id is null
    or not public.social_post_readable(v_post, p_actor)
    or public.social_interaction_blocked(p_actor, v_post.author_profile_id)
  then raise exception 'post not found'; end if;
  if p_kind not in ('cheer', 'save', 'repost') then raise exception 'invalid interaction'; end if;

  if p_kind = 'cheer' then
    if p_active then
      insert into public.social_cheers(post_id, actor_profile_id) values (p_post_id, p_actor) on conflict do nothing;
      if p_actor <> v_post.author_profile_id then
        insert into public.social_notifications(recipient_profile_id, actor_profile_id, kind, source_post_id)
        values (v_post.author_profile_id, p_actor, 'cheer', p_post_id) on conflict do nothing;
      end if;
    else
      delete from public.social_cheers where post_id = p_post_id and actor_profile_id = p_actor;
      delete from public.social_notifications where recipient_profile_id = v_post.author_profile_id and actor_profile_id = p_actor and kind = 'cheer' and source_post_id = p_post_id;
    end if;
  elsif p_kind = 'save' then
    if p_active then insert into public.social_saves(post_id, actor_profile_id) values (p_post_id, p_actor) on conflict do nothing;
    else delete from public.social_saves where post_id = p_post_id and actor_profile_id = p_actor; end if;
  else
    if p_active then
      if p_actor_handle is null or char_length(p_actor_handle) not between 1 and 30 then
        select handle into p_actor_handle from public.profiles where id = p_actor;
      end if;
      insert into public.social_reposts(post_id, actor_profile_id, actor_handle)
      values (p_post_id, p_actor, p_actor_handle) on conflict (post_id, actor_profile_id) do nothing;
      if p_actor <> v_post.author_profile_id then
        insert into public.social_notifications(recipient_profile_id, actor_profile_id, kind, source_post_id)
        values (v_post.author_profile_id, p_actor, 'repost', p_post_id) on conflict do nothing;
      end if;
    else
      delete from public.social_reposts where post_id = p_post_id and actor_profile_id = p_actor;
      delete from public.social_notifications where recipient_profile_id = v_post.author_profile_id and actor_profile_id = p_actor and kind = 'repost' and source_post_id = p_post_id;
    end if;
  end if;
  return true;
end;
$$;

create function public.set_social_comment_policy(p_actor uuid, p_post_id uuid, p_policy text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_policy not in ('open', 'friends', 'locked') then raise exception 'invalid comment policy'; end if;
  update public.social_posts set comment_policy = p_policy, updated_at = now()
  where id = p_post_id and author_profile_id = p_actor and status = 'visible';
  if not found then raise exception 'post not found'; end if;
  return true;
end;
$$;

create function public.create_social_comment(
  p_actor uuid,
  p_post_id uuid,
  p_author_handle text,
  p_body text,
  p_idempotency_key_hash text,
  p_payload_digest text
)
returns setof public.social_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts;
  v_row public.social_comments;
begin
  select * into v_post from public.social_posts where id = p_post_id for update;
  if v_post.id is null
    or not public.social_post_readable(v_post, p_actor)
    or public.social_interaction_blocked(p_actor, v_post.author_profile_id)
  then raise exception 'post not found'; end if;
  if v_post.comment_policy = 'locked'
    or (v_post.comment_policy = 'friends' and p_actor <> v_post.author_profile_id and not (
      exists(select 1 from public.follows where follower_id = p_actor and followee_id = v_post.author_profile_id)
      and exists(select 1 from public.follows where follower_id = v_post.author_profile_id and followee_id = p_actor)
    ))
  then raise exception 'comments not allowed'; end if;

  insert into public.social_comments(post_id, author_profile_id, author_handle, body, idempotency_key_hash, payload_digest)
  values (p_post_id, p_actor, p_author_handle, p_body, p_idempotency_key_hash, p_payload_digest)
  on conflict (author_profile_id, idempotency_key_hash) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.social_comments where author_profile_id = p_actor and idempotency_key_hash = p_idempotency_key_hash;
    if v_row.payload_digest <> p_payload_digest then raise exception 'idempotency conflict'; end if;
  else
    insert into public.social_interaction_moderation_jobs(content_kind, content_id, moderation_claim)
    values ('comment', v_row.id, v_row.body);
  end if;
  return next v_row;
end;
$$;

create function public.create_social_quote(
  p_actor uuid,
  p_post_id uuid,
  p_author_handle text,
  p_body text,
  p_visibility text,
  p_idempotency_key_hash text,
  p_payload_digest text
)
returns setof public.social_quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts;
  v_row public.social_quotes;
begin
  select * into v_post from public.social_posts where id = p_post_id for share;
  if v_post.id is null
    or not public.social_post_readable(v_post, p_actor)
    or public.social_interaction_blocked(p_actor, v_post.author_profile_id)
  then raise exception 'post not found'; end if;
  if p_visibility not in ('public', 'friends', 'private') then raise exception 'invalid quote'; end if;
  insert into public.social_quotes(source_post_id, author_profile_id, author_handle, body, visibility, idempotency_key_hash, payload_digest)
  values (p_post_id, p_actor, p_author_handle, p_body, p_visibility, p_idempotency_key_hash, p_payload_digest)
  on conflict (author_profile_id, idempotency_key_hash) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.social_quotes where author_profile_id = p_actor and idempotency_key_hash = p_idempotency_key_hash;
    if v_row.payload_digest <> p_payload_digest then raise exception 'idempotency conflict'; end if;
  else
    insert into public.social_interaction_moderation_jobs(content_kind, content_id, moderation_claim)
    values ('quote', v_row.id, v_row.body);
  end if;
  return next v_row;
end;
$$;

create function public.complete_social_interaction_moderation(p_kind text, p_content_id uuid, p_decision text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid;
  v_author uuid;
  v_recipient uuid;
begin
  if p_decision not in ('approved', 'needs_review') then raise exception 'invalid moderation decision'; end if;
  if p_kind = 'comment' then
    update public.social_comments set moderation_state = p_decision, updated_at = now()
    where id = p_content_id and moderation_state = 'pending'
    returning post_id, author_profile_id into v_post_id, v_author;
  elsif p_kind = 'quote' then
    update public.social_quotes set moderation_state = p_decision, updated_at = now()
    where id = p_content_id and moderation_state = 'pending'
    returning source_post_id, author_profile_id into v_post_id, v_author;
  else raise exception 'invalid moderation kind'; end if;
  if v_post_id is null then return false; end if;
  delete from public.social_interaction_moderation_jobs where content_kind = p_kind and content_id = p_content_id;
  if p_decision = 'approved' then
    select author_profile_id into v_recipient from public.social_posts where id = v_post_id;
    if v_recipient is not null and v_recipient <> v_author then
      insert into public.social_notifications(recipient_profile_id, actor_profile_id, kind, source_post_id, source_content_id)
      values (v_recipient, v_author, p_kind, v_post_id, p_content_id) on conflict do nothing;
    end if;
  end if;
  return true;
end;
$$;

create function public.claim_social_interaction_moderation_jobs(p_limit integer default 20)
returns table(content_kind text, content_id uuid, moderation_claim text, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'invalid moderation batch'; end if;
  update public.social_interaction_moderation_jobs job
  set state = 'error', lease_until = null, last_error_code = 'lease_expired', updated_at = now()
  where job.state = 'leased' and job.lease_until <= now() and job.attempts >= 8;
  return query
  with candidates as (
    select job.content_kind, job.content_id
    from public.social_interaction_moderation_jobs job
    where job.attempts < 8 and (
      (job.state = 'pending' and job.next_attempt_at <= now())
      or (job.state = 'leased' and job.lease_until <= now())
    )
    order by job.next_attempt_at, job.created_at
    for update skip locked limit p_limit
  )
  update public.social_interaction_moderation_jobs job
  set state = 'leased', lease_until = now() + interval '2 minutes',
      attempts = job.attempts + 1, updated_at = now()
  from candidates
  where job.content_kind = candidates.content_kind and job.content_id = candidates.content_id
  returning job.content_kind, job.content_id, job.moderation_claim, job.attempts;
end;
$$;

create function public.complete_social_interaction_moderation_job(
  p_kind text,
  p_content_id uuid,
  p_decision text,
  p_error_code text,
  p_retry_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision is not null then
    return public.complete_social_interaction_moderation(p_kind, p_content_id, p_decision);
  end if;
  if p_error_code is null then raise exception 'moderation error required'; end if;
  update public.social_interaction_moderation_jobs
  set state = case when p_retry_at is null then 'error' else 'pending' end,
      next_attempt_at = coalesce(p_retry_at, next_attempt_at),
      lease_until = null,
      last_error_code = left(p_error_code, 120),
      updated_at = now()
  where content_kind = p_kind and content_id = p_content_id and state = 'leased';
  return found;
end;
$$;

create function public.read_social_comments(
  p_viewer uuid, p_post_id uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer
)
returns setof public.social_comments
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_post public.social_posts;
begin
  if p_limit < 1 or p_limit > 51 or ((p_before_created_at is null) <> (p_before_id is null)) then raise exception 'invalid page'; end if;
  select * into v_post from public.social_posts where id = p_post_id;
  if v_post.id is null or not public.social_post_readable(v_post, p_viewer) or public.social_interaction_blocked(p_viewer, v_post.author_profile_id) then return; end if;
  return query select comment.* from public.social_comments comment
  where comment.post_id = p_post_id and comment.status = 'visible' and comment.moderation_state = 'approved'
    and not public.social_interaction_blocked(p_viewer, comment.author_profile_id)
    and (p_before_created_at is null or (comment.created_at, comment.id) < (p_before_created_at, p_before_id))
  order by comment.created_at desc, comment.id desc limit p_limit;
end;
$$;

create function public.read_social_derivatives(
  p_viewer uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer
)
returns table(id uuid, kind text, source_post_id uuid, author_profile_id uuid, author_handle text, body text, visibility text, created_at timestamptz, source_post jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 51 or ((p_before_created_at is null) <> (p_before_id is null)) then raise exception 'invalid page'; end if;
  return query
  select derivative.* from (
    select quote.id, 'quote'::text kind, quote.source_post_id, quote.author_profile_id, quote.author_handle,
      quote.body, quote.visibility, quote.created_at, to_jsonb(post) source_post
    from public.social_quotes quote join public.social_posts post on post.id = quote.source_post_id
    where quote.status = 'visible' and quote.moderation_state = 'approved'
      and public.social_post_readable(post, p_viewer)
      and not public.social_interaction_blocked(p_viewer, post.author_profile_id)
      and not public.social_interaction_blocked(p_viewer, quote.author_profile_id)
      and (quote.author_profile_id = p_viewer or quote.visibility = 'public' or (
        quote.visibility = 'friends'
        and exists(select 1 from public.follows where follower_id = p_viewer and followee_id = quote.author_profile_id)
        and exists(select 1 from public.follows where follower_id = quote.author_profile_id and followee_id = p_viewer)
      ))
    union all
    select repost.id, 'repost'::text, repost.post_id, repost.actor_profile_id, repost.actor_handle,
      null::text, post.visibility, repost.created_at, to_jsonb(post)
    from public.social_reposts repost join public.social_posts post on post.id = repost.post_id
    where public.social_post_readable(post, p_viewer)
      and not public.social_interaction_blocked(p_viewer, post.author_profile_id)
      and not public.social_interaction_blocked(p_viewer, repost.actor_profile_id)
  ) derivative
  where p_before_created_at is null or (derivative.created_at, derivative.id) < (p_before_created_at, p_before_id)
  order by derivative.created_at desc, derivative.id desc limit p_limit;
end;
$$;

create function public.read_social_interaction_summary(p_viewer uuid, p_post_id uuid)
returns table(cheered boolean, saved boolean, reposted boolean, cheer_count bigint, repost_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_post public.social_posts;
begin
  select * into v_post from public.social_posts where id = p_post_id;
  if v_post.id is null or not public.social_post_readable(v_post, p_viewer) or public.social_interaction_blocked(p_viewer, v_post.author_profile_id) then
    return query select false, false, false, 0::bigint, 0::bigint; return;
  end if;
  return query select
    exists(select 1 from public.social_cheers where post_id = p_post_id and actor_profile_id = p_viewer),
    exists(select 1 from public.social_saves where post_id = p_post_id and actor_profile_id = p_viewer),
    exists(select 1 from public.social_reposts where post_id = p_post_id and actor_profile_id = p_viewer),
    (select count(*) from public.social_cheers cheer where cheer.post_id = p_post_id and not public.social_interaction_blocked(p_viewer, cheer.actor_profile_id)),
    (select count(*) from public.social_reposts repost where repost.post_id = p_post_id and not public.social_interaction_blocked(p_viewer, repost.actor_profile_id));
end;
$$;

create function public.read_social_cheers(
  p_viewer uuid, p_post_id uuid, p_before_created_at timestamptz, p_before_profile_id uuid, p_limit integer
)
returns table(profile_id uuid, handle text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_post public.social_posts;
begin
  if p_limit < 1 or p_limit > 51 or ((p_before_created_at is null) <> (p_before_profile_id is null)) then raise exception 'invalid page'; end if;
  select * into v_post from public.social_posts where id = p_post_id;
  if v_post.id is null or not public.social_post_readable(v_post, p_viewer) or public.social_interaction_blocked(p_viewer, v_post.author_profile_id) then return; end if;
  return query
  select cheer.actor_profile_id, profile.handle, cheer.created_at
  from public.social_cheers cheer join public.profiles profile on profile.id = cheer.actor_profile_id
  where cheer.post_id = p_post_id
    and not public.social_interaction_blocked(p_viewer, cheer.actor_profile_id)
    and (p_before_created_at is null or (cheer.created_at, cheer.actor_profile_id) < (p_before_created_at, p_before_profile_id))
  order by cheer.created_at desc, cheer.actor_profile_id desc limit p_limit;
end;
$$;

create function public.read_social_saves(
  p_viewer uuid, p_before_created_at timestamptz, p_before_post_id uuid, p_limit integer
)
returns table(post_id uuid, saved_at timestamptz, source_post jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select save.post_id, save.created_at, to_jsonb(post)
  from public.social_saves save join public.social_posts post on post.id = save.post_id
  where save.actor_profile_id = p_viewer
    and public.social_post_readable(post, p_viewer)
    and not public.social_interaction_blocked(p_viewer, post.author_profile_id)
    and (p_before_created_at is null or (save.created_at, save.post_id) < (p_before_created_at, p_before_post_id))
  order by save.created_at desc, save.post_id desc limit p_limit;
$$;

create function public.read_social_notifications(
  p_viewer uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer
)
returns setof public.social_notifications
language sql
stable
security definer
set search_path = public
as $$
  select notification.*
  from public.social_notifications notification join public.social_posts post on post.id = notification.source_post_id
  where notification.recipient_profile_id = p_viewer
    and public.social_post_readable(post, p_viewer)
    and not public.social_interaction_blocked(p_viewer, notification.actor_profile_id)
    and not public.social_interaction_blocked(p_viewer, post.author_profile_id)
    and (p_before_created_at is null or (notification.created_at, notification.id) < (p_before_created_at, p_before_id))
  order by notification.created_at desc, notification.id desc limit p_limit;
$$;

create function public.mark_social_notification_read(p_viewer uuid, p_id uuid, p_read boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.social_notifications set read_at = case when p_read then now() else null end
  where id = p_id and recipient_profile_id = p_viewer;
  return found;
end;
$$;

create function public.append_social_feature_update(
  p_actor uuid, p_post_id uuid, p_status text, p_response text, p_idempotency_key_hash text, p_payload_digest text
)
returns setof public.social_feature_request_updates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff public.private_social_staff_roles;
  v_post public.social_posts;
  v_row public.social_feature_request_updates;
begin
  select * into v_staff from public.private_social_staff_roles where profile_id = p_actor and active and revoked_at is null;
  if v_staff.id is null then raise exception 'staff required'; end if;
  select * into v_post from public.social_posts post
  where post.id = p_post_id and post.kind = 'feature_request'
    and public.social_post_readable(post, p_actor)
    and not public.social_interaction_blocked(p_actor, post.author_profile_id)
  for update;
  if v_post.id is null then raise exception 'feature request not found'; end if;
  insert into public.social_feature_request_updates(
    post_id, staff_role_id, status, response, idempotency_key_hash, payload_digest, created_at
  )
  values (
    p_post_id, v_staff.id, p_status, p_response, p_idempotency_key_hash, p_payload_digest, clock_timestamp()
  )
  on conflict (staff_role_id, idempotency_key_hash) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.social_feature_request_updates where staff_role_id = v_staff.id and idempotency_key_hash = p_idempotency_key_hash;
    if v_row.payload_digest <> p_payload_digest then raise exception 'idempotency conflict'; end if;
  else
    update public.social_posts
    set feature_status = p_status, feature_staff_response = p_response, updated_at = now()
    where id = p_post_id;
    if p_actor <> v_post.author_profile_id then
      insert into public.social_notifications(recipient_profile_id, actor_profile_id, kind, source_post_id, source_content_id)
      values (v_post.author_profile_id, p_actor, 'feature_update', p_post_id, v_row.id) on conflict do nothing;
    end if;
  end if;
  return next v_row;
end;
$$;

create function public.read_social_feature_history(
  p_viewer uuid, p_post_id uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer
)
returns table(id uuid, status text, response text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select update.id, update.status, update.response, update.created_at
  from public.social_feature_request_updates update join public.social_posts post on post.id = update.post_id
  where update.post_id = p_post_id and public.social_post_readable(post, p_viewer)
    and not public.social_interaction_blocked(p_viewer, post.author_profile_id)
    and (p_before_created_at is null or (update.created_at, update.id) < (p_before_created_at, p_before_id))
  order by update.created_at desc, update.id desc limit p_limit;
$$;

create function public.read_social_feature_status(p_viewer uuid, p_post_id uuid)
returns table(current_status text)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select update.status
    from public.social_feature_request_updates update
    where update.post_id = post.id
    order by update.created_at desc, update.id desc limit 1
  ), post.feature_status, 'submitted')
  from public.social_posts post
  where post.id = p_post_id and post.kind = 'feature_request'
    and public.social_post_readable(post, p_viewer)
    and not public.social_interaction_blocked(p_viewer, post.author_profile_id);
$$;

create function public.read_social_feature_queue(
  p_actor uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer
)
returns setof public.social_posts
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists(select 1 from public.private_social_staff_roles where profile_id = p_actor and active and revoked_at is null) then
    raise exception 'staff required';
  end if;
  if p_limit < 1 or p_limit > 51 or ((p_before_created_at is null) <> (p_before_id is null)) then raise exception 'invalid page'; end if;
  return query select post.* from public.social_posts post
  where post.kind = 'feature_request' and public.social_post_readable(post, p_actor)
    and not public.social_interaction_blocked(p_actor, post.author_profile_id)
    and (p_before_created_at is null or (post.created_at, post.id) < (p_before_created_at, p_before_id))
  order by post.created_at desc, post.id desc limit p_limit;
end;
$$;

create function public.report_social_content(p_actor uuid, p_kind text, p_content_id uuid, p_reason text)
returns setof public.social_content_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visible boolean := false;
  v_row public.social_content_reports;
begin
  if p_kind = 'post' then
    select public.social_post_readable(post, p_actor) and not public.social_interaction_blocked(p_actor, post.author_profile_id)
    into v_visible from public.social_posts post where post.id = p_content_id;
  elsif p_kind = 'comment' then
    select comment.status = 'visible' and comment.moderation_state = 'approved'
      and public.social_post_readable(post, p_actor)
      and not public.social_interaction_blocked(p_actor, comment.author_profile_id)
      and not public.social_interaction_blocked(p_actor, post.author_profile_id)
    into v_visible from public.social_comments comment join public.social_posts post on post.id = comment.post_id where comment.id = p_content_id;
  elsif p_kind = 'quote' then
    select quote.status = 'visible' and quote.moderation_state = 'approved'
      and public.social_post_readable(post, p_actor)
      and not public.social_interaction_blocked(p_actor, quote.author_profile_id)
      and not public.social_interaction_blocked(p_actor, post.author_profile_id)
      and (
        quote.author_profile_id = p_actor
        or quote.visibility = 'public'
        or (
          quote.visibility = 'friends'
          and exists(select 1 from public.follows where follower_id = p_actor and followee_id = quote.author_profile_id)
          and exists(select 1 from public.follows where follower_id = quote.author_profile_id and followee_id = p_actor)
        )
      )
    into v_visible from public.social_quotes quote join public.social_posts post on post.id = quote.source_post_id where quote.id = p_content_id;
  end if;
  if not coalesce(v_visible, false) then raise exception 'content not found'; end if;
  insert into public.social_content_reports(reporter_profile_id, content_kind, content_id, reason)
  values (p_actor, p_kind, p_content_id, p_reason)
  on conflict (reporter_profile_id, content_kind, content_id, reason) do update set reason = excluded.reason
  returning * into v_row;
  return next v_row;
end;
$$;

create function public.read_social_report_queue(
  p_actor uuid, p_before_created_at timestamptz, p_before_id uuid, p_limit integer
)
returns setof public.social_content_reports
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.private_social_staff_roles
    where profile_id = p_actor and active and revoked_at is null and role = 'moderator'
  ) then raise exception 'staff required'; end if;
  if p_limit < 1 or p_limit > 51 or ((p_before_created_at is null) <> (p_before_id is null)) then
    raise exception 'invalid page';
  end if;
  return query
  select report.* from public.social_content_reports report
  where report.state in ('queued', 'reviewing')
    and (p_before_created_at is null or (report.created_at, report.id) < (p_before_created_at, p_before_id))
  order by report.created_at desc, report.id desc limit p_limit;
end;
$$;

create function public.resolve_social_report(p_actor uuid, p_report_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  select * into v_staff from public.private_social_staff_roles
  where profile_id = p_actor and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  update public.social_content_reports
  set state = 'resolved', resolved_at = now(), resolved_by_staff_role_id = v_staff.id
  where id = p_report_id and state in ('queued', 'reviewing');
  if not found then raise exception 'report not found'; end if;
  return true;
end;
$$;

create function public.moderate_social_interaction(p_actor uuid, p_kind text, p_content_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  select * into v_staff from public.private_social_staff_roles where profile_id = p_actor and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action not in ('hide', 'restore') then raise exception 'invalid moderation action'; end if;
  if not exists (
    select 1 from public.social_content_reports report
    where report.content_kind = p_kind and report.content_id = p_content_id
      and report.state in ('queued', 'reviewing')
  ) then raise exception 'queued report required'; end if;
  if p_kind = 'comment' then
    update public.social_comments set status = case when p_action = 'hide' then 'hidden' else 'visible' end, updated_at = now() where id = p_content_id;
  elsif p_kind = 'quote' then
    update public.social_quotes set status = case when p_action = 'hide' then 'hidden' else 'visible' end, updated_at = now() where id = p_content_id;
  else raise exception 'invalid moderation kind'; end if;
  if not found then raise exception 'content not found'; end if;
  insert into public.social_moderation_actions(staff_role_id, content_kind, content_id, action)
  values (v_staff.id, p_kind, p_content_id, p_action);
  return true;
end;
$$;

alter table public.social_blocks enable row level security;
alter table public.social_cheers enable row level security;
alter table public.social_saves enable row level security;
alter table public.social_reposts enable row level security;
alter table public.social_comments enable row level security;
alter table public.social_quotes enable row level security;
alter table public.social_interaction_moderation_jobs enable row level security;
alter table public.private_social_staff_roles enable row level security;
alter table public.social_feature_request_updates enable row level security;
alter table public.social_notifications enable row level security;
alter table public.social_content_reports enable row level security;
alter table public.social_moderation_actions enable row level security;

revoke all on table public.social_blocks, public.social_cheers, public.social_saves,
  public.social_reposts, public.social_comments, public.social_quotes,
  public.social_interaction_moderation_jobs, public.private_social_staff_roles,
  public.social_feature_request_updates, public.social_notifications,
  public.social_content_reports, public.social_moderation_actions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.social_blocks, public.social_cheers, public.social_saves,
  public.social_reposts, public.social_comments, public.social_quotes,
  public.social_interaction_moderation_jobs, public.private_social_staff_roles,
  public.social_feature_request_updates, public.social_notifications,
  public.social_content_reports, public.social_moderation_actions
  to service_role;

revoke all on function public.social_interaction_blocked(uuid,uuid) from public, anon, authenticated;
revoke all on function public.set_social_block(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.set_social_desired_interaction(uuid,uuid,text,boolean,text) from public, anon, authenticated;
revoke all on function public.set_social_comment_policy(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.create_social_comment(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.create_social_quote(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.complete_social_interaction_moderation(text,uuid,text) from public, anon, authenticated;
revoke all on function public.claim_social_interaction_moderation_jobs(integer) from public, anon, authenticated;
revoke all on function public.complete_social_interaction_moderation_job(text,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.read_social_comments(uuid,uuid,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.read_social_derivatives(uuid,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.read_social_interaction_summary(uuid,uuid) from public, anon, authenticated;
revoke all on function public.read_social_cheers(uuid,uuid,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.read_social_saves(uuid,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.read_social_notifications(uuid,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.mark_social_notification_read(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.append_social_feature_update(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.read_social_feature_history(uuid,uuid,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.read_social_feature_status(uuid,uuid) from public, anon, authenticated;
revoke all on function public.read_social_feature_queue(uuid,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.report_social_content(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.read_social_report_queue(uuid,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.resolve_social_report(uuid,uuid) from public, anon, authenticated;
revoke all on function public.moderate_social_interaction(uuid,text,uuid,text) from public, anon, authenticated;

grant execute on function public.social_interaction_blocked(uuid,uuid),
  public.set_social_block(uuid,uuid,boolean),
  public.set_social_desired_interaction(uuid,uuid,text,boolean,text),
  public.set_social_comment_policy(uuid,uuid,text),
  public.create_social_comment(uuid,uuid,text,text,text,text),
  public.create_social_quote(uuid,uuid,text,text,text,text,text),
  public.complete_social_interaction_moderation(text,uuid,text),
  public.claim_social_interaction_moderation_jobs(integer),
  public.complete_social_interaction_moderation_job(text,uuid,text,text,timestamptz),
  public.read_social_comments(uuid,uuid,timestamptz,uuid,integer),
  public.read_social_derivatives(uuid,timestamptz,uuid,integer),
  public.read_social_interaction_summary(uuid,uuid),
  public.read_social_cheers(uuid,uuid,timestamptz,uuid,integer),
  public.read_social_saves(uuid,timestamptz,uuid,integer),
  public.read_social_notifications(uuid,timestamptz,uuid,integer),
  public.mark_social_notification_read(uuid,uuid,boolean),
  public.append_social_feature_update(uuid,uuid,text,text,text,text),
  public.read_social_feature_history(uuid,uuid,timestamptz,uuid,integer),
  public.read_social_feature_status(uuid,uuid),
  public.read_social_feature_queue(uuid,timestamptz,uuid,integer),
  public.report_social_content(uuid,text,uuid,text),
  public.read_social_report_queue(uuid,timestamptz,uuid,integer),
  public.resolve_social_report(uuid,uuid),
  public.moderate_social_interaction(uuid,text,uuid,text)
to service_role;
