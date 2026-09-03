-- Private Social photos, consented photo tags, immutable edit audit, and
-- revision/media-bound moderation. Browser roles remain API-only.

create extension if not exists pgcrypto;

alter table public.social_posts drop constraint social_posts_public_venue_check;

create table public.social_post_media (
  id uuid primary key,
  generation uuid not null,
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  object_key text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width between 1 and 1200),
  height integer not null check (height between 1 and 1200),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  content_type text not null default 'image/jpeg' check (content_type = 'image/jpeg'),
  moderation_state text not null default 'pending'
    check (moderation_state in ('pending', 'approved', 'needs_review')),
  attachment_state text not null default 'active'
    check (attachment_state in ('active', 'detached', 'purging')),
  retention_expires_at timestamptz,
  cleanup_token uuid,
  cleanup_lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_post_media_private_path_check check (
    object_key = 'social/' || id::text || '/' || generation::text || '/image.jpg'
  )
);

create table public.social_post_media_uploads (
  media_id uuid primary key,
  generation uuid not null,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  object_key text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width between 1 and 1200),
  height integer not null check (height between 1 and 1200),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  state text not null default 'staged' check (state in ('staged','cleanup')),
  cleanup_token uuid,
  cleanup_lease_until timestamptz,
  created_at timestamptz not null default now(),
  constraint social_post_media_upload_private_path_check check (
    object_key = 'social/' || media_id::text || '/' || generation::text || '/image.jpg'
  )
);

do $$ begin
  if exists (select 1 from public.social_posts where photo_media_id is not null) then
    raise exception '0074 requires Task 3 photo_media_id rows to be null before private media migration';
  end if;
end $$;

alter table public.social_posts
  add constraint social_posts_photo_media_fk
  foreign key (photo_media_id) references public.social_post_media(id) on delete restrict;
create unique index social_posts_one_media_attachment_idx
  on public.social_posts(photo_media_id) where photo_media_id is not null;

alter table public.social_post_moderation_jobs
  add column media_id uuid references public.social_post_media(id) on delete restrict,
  add column lease_token uuid;

create table public.social_post_edit_audit (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  from_mutation_version integer not null check (from_mutation_version >= 0),
  to_mutation_version integer not null check (to_mutation_version = from_mutation_version + 1),
  changed_fields text[] not null check (cardinality(changed_fields) > 0),
  previous_digest text not null check (previous_digest ~ '^[0-9a-f]{64}$'),
  next_digest text not null check (next_digest ~ '^[0-9a-f]{64}$'),
  edited_at timestamptz not null default now(),
  unique (post_id, to_mutation_version)
);

create table public.social_post_media_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null,
  post_id uuid not null,
  actor_profile_id uuid not null,
  action text not null check (action in ('detached', 'purged')),
  retention_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.social_post_create_requests (
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  media_id uuid references public.social_post_media(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(author_profile_id,idempotency_key)
);

create table public.social_post_tag_proposals (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  media_id uuid references public.social_post_media(id) on delete set null,
  author_profile_id uuid not null references public.profiles(id) on delete restrict,
  target_profile_id uuid not null references public.profiles(id) on delete cascade,
  state text not null default 'proposed'
    check (state in ('proposed', 'approved', 'declined', 'withdrawn', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  audience_visibility text check (audience_visibility in ('public', 'friends', 'private')),
  audience_revision integer check (audience_revision >= 0),
  audience_shown_at timestamptz,
  unique (post_id, media_id, target_profile_id),
  check (author_profile_id <> target_profile_id)
);

create table public.social_post_tag_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.social_post_tag_proposals(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('propose', 'approve', 'decline', 'withdraw', 'cancel', 'audience_change')),
  created_at timestamptz not null default now()
);

create table public.social_post_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  staff_role_id uuid not null references public.private_social_staff_roles(id) on delete restrict,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  media_id uuid references public.social_post_media(id) on delete set null,
  action text not null check (action in ('approve', 'hide')),
  created_at timestamptz not null default now()
);

alter table public.social_notifications drop constraint social_notifications_kind_check;
alter table public.social_notifications add constraint social_notifications_kind_check
  check (kind in ('cheer', 'comment', 'repost', 'quote', 'feature_update', 'tag_proposal'));

create function public.reject_social_append_only_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'append-only Social audit';
end;
$$;

create function public.create_social_post_idempotent(
  p_author_profile_id uuid,p_author_handle text,p_kind text,p_visibility text,p_body text,
  p_area_slug text,p_venue_id text,p_hashtags text[],p_comment_policy text,p_media_id uuid,
  p_object_key text,p_sha256 text,p_width integer,p_height integer,p_byte_size integer,
  p_photo_alt_text text,p_tag_handles text[],p_idempotency_key text,p_request_digest text
)
returns setof public.social_posts language plpgsql security definer set search_path=public as $$
declare v_request public.social_post_create_requests; v_post public.social_posts;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' or p_request_digest !~ '^[0-9a-f]{64}$'
    then raise exception 'invalid idempotency request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_author_profile_id::text || ':' || p_idempotency_key,0));
  select * into v_request from public.social_post_create_requests
    where author_profile_id=p_author_profile_id and idempotency_key=p_idempotency_key;
  if v_request.post_id is not null then
    if v_request.request_digest<>p_request_digest then raise exception 'idempotency conflict'; end if;
    return query select * from public.social_posts where id=v_request.post_id;
    return;
  end if;
  select * into v_post from public.create_social_post(p_author_profile_id,p_author_handle,p_kind,p_visibility,p_body,
    p_area_slug,p_venue_id,p_hashtags,p_comment_policy,p_media_id,p_object_key,p_sha256,p_width,p_height,
    p_byte_size,p_photo_alt_text,p_tag_handles);
  insert into public.social_post_create_requests(author_profile_id,idempotency_key,request_digest,post_id,media_id)
  values(p_author_profile_id,p_idempotency_key,p_request_digest,v_post.id,p_media_id);
  return next v_post;
end; $$;

create trigger social_post_edit_audit_immutable
before update or delete on public.social_post_edit_audit
for each row execute function public.reject_social_append_only_change();
create trigger social_post_media_lifecycle_events_immutable
before update or delete on public.social_post_media_lifecycle_events
for each row execute function public.reject_social_append_only_change();
create trigger social_post_tag_events_immutable
before update or delete on public.social_post_tag_events
for each row execute function public.reject_social_append_only_change();
create trigger social_post_moderation_actions_immutable
before update or delete on public.social_post_moderation_actions
for each row execute function public.reject_social_append_only_change();

create function public.guard_social_post_photo_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.photo_media_id is not null and not exists (
    select 1 from public.social_post_media media
    where media.id = new.photo_media_id
      and media.owner_profile_id = new.author_profile_id
      and media.attachment_state = 'active'
  ) then
    raise exception 'invalid Social photo';
  end if;
  return new;
end;
$$;

create function public.reserve_social_post_media_upload(
  p_owner_profile_id uuid,p_media_id uuid,p_sha256 text,p_width integer,p_height integer,p_byte_size integer
)
returns table(media_id uuid,generation uuid,object_key text)
language plpgsql security definer set search_path=public as $$
declare v_upload public.social_post_media_uploads; v_generation uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('social-media-upload:' || p_media_id::text,0));
  select * into v_upload from public.social_post_media_uploads upload where upload.media_id=p_media_id for update;
  if v_upload.media_id is null then
    v_generation := gen_random_uuid();
    insert into public.social_post_media_uploads(
      media_id,generation,owner_profile_id,object_key,sha256,width,height,byte_size
    ) values (
      p_media_id,v_generation,p_owner_profile_id,
      'social/' || p_media_id::text || '/' || v_generation::text || '/image.jpg',
      p_sha256,p_width,p_height,p_byte_size
    ) returning * into v_upload;
  elsif v_upload.owner_profile_id<>p_owner_profile_id or v_upload.sha256<>p_sha256
    or v_upload.width<>p_width or v_upload.height<>p_height or v_upload.byte_size<>p_byte_size
  then raise exception 'invalid Social photo reservation';
  elsif v_upload.state='cleanup' then
    raise exception 'Social photo cleanup in progress';
  end if;
  return query select v_upload.media_id,v_upload.generation,v_upload.object_key;
end; $$;

create function public.claim_social_post_media_upload_cleanup(
  p_owner_profile_id uuid,p_media_id uuid,p_generation uuid
)
returns table(generation uuid,object_key text,cleanup_token uuid)
language plpgsql security definer set search_path=public as $$
begin
  return query update public.social_post_media_uploads upload set
    state='cleanup',cleanup_token=gen_random_uuid(),cleanup_lease_until=now()+interval '5 minutes'
  where upload.media_id=p_media_id and upload.owner_profile_id=p_owner_profile_id
    and upload.generation=p_generation
    and (upload.state='staged' or (upload.state='cleanup' and upload.cleanup_lease_until<now()))
  returning upload.generation,upload.object_key,upload.cleanup_token;
end; $$;

create function public.claim_social_post_media_upload_cleanup_batch(
  p_limit integer,p_staged_before timestamptz
)
returns table(media_id uuid,generation uuid,object_key text,cleanup_token uuid)
language plpgsql security definer set search_path=public as $$
begin
  if p_limit<1 or p_limit>100 then raise exception 'invalid media cleanup batch'; end if;
  return query with candidates as (
    select upload.media_id from public.social_post_media_uploads upload
    where (upload.state='cleanup' and upload.cleanup_lease_until<now())
      or (upload.state='staged' and upload.created_at<=p_staged_before)
    order by upload.created_at,upload.media_id for update skip locked limit p_limit
  )
  update public.social_post_media_uploads upload set state='cleanup',cleanup_token=gen_random_uuid(),
    cleanup_lease_until=now()+interval '5 minutes'
  from candidates where upload.media_id=candidates.media_id
  returning upload.media_id,upload.generation,upload.object_key,upload.cleanup_token;
end; $$;

create function public.finalize_social_post_media_upload_cleanup(
  p_media_id uuid,p_generation uuid,p_cleanup_token uuid
)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  delete from public.social_post_media_uploads upload
  where upload.media_id=p_media_id and upload.generation=p_generation
    and upload.cleanup_token=p_cleanup_token and upload.state='cleanup';
  return found;
end; $$;

create function public.claim_social_post_media_cleanup_batch(p_limit integer default 50)
returns table(media_id uuid,generation uuid,object_key text,cleanup_token uuid)
language plpgsql security definer set search_path=public as $$
begin
  if p_limit<1 or p_limit>100 then raise exception 'invalid media cleanup batch'; end if;
  return query with candidates as (
    select media.id from public.social_post_media media
    where (media.attachment_state='detached' and media.retention_expires_at<=now())
      or (media.attachment_state='purging' and media.cleanup_lease_until<now())
    order by media.retention_expires_at,media.id for update skip locked limit p_limit
  )
  update public.social_post_media media set attachment_state='purging',cleanup_token=gen_random_uuid(),
    cleanup_lease_until=now()+interval '5 minutes',updated_at=now()
  from candidates where media.id=candidates.id
  returning media.id,media.generation,media.object_key,media.cleanup_token;
end; $$;

create function public.finalize_social_post_media_cleanup(
  p_media_id uuid,p_generation uuid,p_cleanup_token uuid
)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_media public.social_post_media; v_detached public.social_post_media_lifecycle_events;
begin
  select * into v_media from public.social_post_media media
  where media.id=p_media_id and media.generation=p_generation and media.cleanup_token=p_cleanup_token
    and media.attachment_state='purging' for update;
  if v_media.id is null then return false; end if;
  select * into v_detached from public.social_post_media_lifecycle_events event
  where event.media_id=p_media_id and event.action='detached'
  order by event.created_at desc,event.id desc limit 1;
  if v_detached.id is null then raise exception 'Social media lifecycle is unavailable'; end if;
  insert into public.social_post_media_lifecycle_events(
    media_id,post_id,actor_profile_id,action,retention_expires_at
  ) values (p_media_id,v_detached.post_id,v_detached.actor_profile_id,'purged',v_media.retention_expires_at);
  delete from public.social_post_media media where media.id=p_media_id and media.generation=p_generation
    and media.cleanup_token=p_cleanup_token and media.attachment_state='purging';
  return found;
end; $$;

create trigger social_posts_photo_owner_guard
before insert or update of photo_media_id, author_profile_id on public.social_posts
for each row execute function public.guard_social_post_photo_owner();

create function public.guard_social_post_tag_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.social_posts post
    where post.id = new.post_id
      and post.photo_media_id = new.media_id
      and post.author_profile_id = new.author_profile_id
  ) or public.social_interaction_blocked(new.author_profile_id, new.target_profile_id)
  then raise exception 'invalid Social tag';
  end if;
  return new;
end;
$$;

create trigger social_post_tag_proposal_guard
before insert on public.social_post_tag_proposals
for each row execute function public.guard_social_post_tag_proposal();

-- search_path includes extensions because Supabase installs pgcrypto's
-- digest() there, not in public; local test postgres puts it in public,
-- and a nonexistent schema in search_path is silently skipped, so this
-- is safe on both.
create or replace function public.social_post_digest(p_post public.social_posts)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(digest(convert_to(jsonb_build_object(
    'kind', p_post.kind,
    'status', p_post.status,
    'visibility', p_post.visibility,
    'body', p_post.body,
    'area', p_post.area_slug,
    'venue', p_post.venue_id,
    'hashtags', p_post.hashtags,
    'commentPolicy', p_post.comment_policy,
    'photoMediaId', p_post.photo_media_id,
    'photoAltText', p_post.photo_alt_text
  )::text, 'utf8'), 'sha256'), 'hex');
$$;

create or replace function public.queue_social_post_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.moderation_state = 'pending' then
    insert into public.social_post_moderation_jobs(post_id, revision, media_id, moderation_claim)
    values (
      new.id,
      new.revision,
      new.photo_media_id,
      concat_ws(E'\n\n', nullif(new.body,''),
        case when cardinality(new.hashtags)>0 then '#' || array_to_string(new.hashtags,' #') end,
        case when new.photo_alt_text is not null then 'Photo: ' || new.photo_alt_text end)
    )
    on conflict (post_id) do update set
      state = 'pending',
      revision = excluded.revision,
      media_id = excluded.media_id,
      moderation_claim = excluded.moderation_claim,
      attempts = 0,
      next_attempt_at = now(),
      lease_until = null,
      lease_token = null,
      last_error_code = null,
      updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.social_post_exact_venue_allowed(
  p_post public.social_posts,
  p_viewer_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_post.author_profile_id = p_viewer_profile_id or (
    exists (select 1 from public.follows
      where follower_id = p_viewer_profile_id and followee_id = p_post.author_profile_id)
    and exists (select 1 from public.follows
      where follower_id = p_post.author_profile_id and followee_id = p_viewer_profile_id)
  );
$$;

create or replace function public.read_social_post(p_post_id uuid, p_viewer_profile_id uuid)
returns setof public.social_posts
language sql
stable
security definer
set search_path = public
as $$
  select projected.*
  from public.social_posts post
  cross join lateral jsonb_populate_record(
    null::public.social_posts,
    to_jsonb(post) || jsonb_build_object(
      'venue_id', case when public.social_post_exact_venue_allowed(post, p_viewer_profile_id)
        then post.venue_id else null end
    )
  ) projected
  where post.id = p_post_id
    and public.social_post_readable(post, p_viewer_profile_id)
    and not public.social_interaction_blocked(p_viewer_profile_id, post.author_profile_id);
$$;

create function public.read_social_post_outbox_item(p_post_id uuid, p_owner uuid)
returns setof public.social_posts
language sql
stable
security definer
set search_path = public
as $$
  select post.*
  from public.social_posts post
  where post.id = p_post_id
    and post.author_profile_id = p_owner
    and post.status = 'visible';
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
  if p_lane not in ('discover', 'nearby', 'following')
    or p_limit < 1 or p_limit > 51
    or (p_lane = 'nearby' and p_area_slug is null)
    or ((p_before_created_at is null) <> (p_before_id is null))
  then raise exception 'invalid social feed request';
  end if;
  return query
  select projected.*
  from public.social_posts post
  cross join lateral jsonb_populate_record(
    null::public.social_posts,
    to_jsonb(post) || jsonb_build_object(
      'venue_id', case when public.social_post_exact_venue_allowed(post, p_viewer_profile_id)
        then post.venue_id else null end
    )
  ) projected
  where public.social_post_readable(post, p_viewer_profile_id)
    and not public.social_interaction_blocked(p_viewer_profile_id, post.author_profile_id)
    and (p_before_created_at is null or (post.created_at, post.id) < (p_before_created_at, p_before_id))
    and case p_lane
      when 'discover' then post.visibility = 'public'
      when 'nearby' then post.visibility = 'public' and post.area_slug = p_area_slug
      when 'following' then exists (select 1 from public.follows
        where follower_id = p_viewer_profile_id and followee_id = post.author_profile_id)
        and (post.visibility = 'public' or (
          post.visibility = 'friends' and exists (select 1 from public.follows
            where follower_id = post.author_profile_id and followee_id = p_viewer_profile_id)
        ))
      else false
    end
  order by post.created_at desc, post.id desc
  limit p_limit;
end;
$$;

create function public.create_social_post(
  p_author_profile_id uuid,
  p_author_handle text,
  p_kind text,
  p_visibility text,
  p_body text,
  p_area_slug text,
  p_venue_id text,
  p_hashtags text[],
  p_comment_policy text,
  p_media_id uuid,
  p_object_key text,
  p_sha256 text,
  p_width integer,
  p_height integer,
  p_byte_size integer,
  p_photo_alt_text text,
  p_tag_handles text[]
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts;
  v_target record;
  v_upload public.social_post_media_uploads;
  v_tag_count integer;
begin
  if (p_media_id is null) <> (p_object_key is null)
    or (p_media_id is null and (p_sha256 is not null or p_width is not null or p_height is not null
      or p_byte_size is not null or p_photo_alt_text is not null or cardinality(coalesce(p_tag_handles, '{}')) > 0))
    or (p_media_id is not null and (p_sha256 is null or p_width is null or p_height is null
      or p_byte_size is null or p_photo_alt_text is null))
  then raise exception 'invalid Social photo';
  end if;
  if cardinality(coalesce(p_tag_handles, '{}')) > 10 then raise exception 'invalid Social tags'; end if;
  if p_media_id is not null then
    select * into v_upload from public.social_post_media_uploads upload
      where upload.media_id=p_media_id and upload.owner_profile_id=p_author_profile_id
        and upload.object_key=p_object_key and upload.sha256=p_sha256 and upload.width=p_width
        and upload.height=p_height and upload.byte_size=p_byte_size and upload.state='staged'
      for update;
    if v_upload.media_id is null then raise exception 'invalid Social photo reservation'; end if;
    insert into public.social_post_media(id,generation,owner_profile_id,object_key,sha256,width,height,byte_size)
    values (p_media_id,v_upload.generation,p_author_profile_id,p_object_key,p_sha256,p_width,p_height,p_byte_size);
    delete from public.social_post_media_uploads where media_id=p_media_id;
  end if;
  insert into public.social_posts(
    author_profile_id,author_handle,kind,visibility,body,area_slug,venue_id,hashtags,
    comment_policy,photo_media_id,photo_alt_text,feature_status
  ) values (
    p_author_profile_id,p_author_handle,p_kind,p_visibility,p_body,p_area_slug,p_venue_id,
    coalesce(p_hashtags,'{}'),p_comment_policy,p_media_id,p_photo_alt_text,
    case when p_kind='feature_request' then 'submitted' else null end
  ) returning * into v_post;
  if cardinality(coalesce(p_tag_handles, '{}')) > 0 then
    select count(distinct profile.id)::integer into v_tag_count
    from public.profiles profile
    where lower(profile.handle) = any(p_tag_handles)
      and profile.id <> p_author_profile_id
      and not public.social_interaction_blocked(p_author_profile_id, profile.id);
    if v_tag_count <> cardinality(p_tag_handles)
      or exists (select 1 from unnest(p_tag_handles) handle where handle !~ '^[a-z0-9_]{1,30}$')
    then raise exception 'invalid Social tags';
    end if;
    for v_target in select profile.id, profile.handle from public.profiles profile
      where lower(profile.handle) = any(p_tag_handles)
    loop
      insert into public.social_post_tag_proposals(post_id,media_id,author_profile_id,target_profile_id)
      values (v_post.id,p_media_id,p_author_profile_id,v_target.id);
    end loop;
    for v_target in select proposal.id, proposal.target_profile_id
      from public.social_post_tag_proposals proposal where proposal.post_id=v_post.id
    loop
      insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
      values (v_target.id,p_author_profile_id,'propose');
      insert into public.social_notifications(recipient_profile_id,actor_profile_id,kind,source_post_id,source_content_id)
      values (v_target.target_profile_id,p_author_profile_id,'tag_proposal',v_post.id,v_target.id)
      on conflict do nothing;
    end loop;
  end if;
  return next v_post;
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
declare
  v_old public.social_posts;
  v_new public.social_posts;
  v_fields text[] := '{}';
  v_moderation_changed boolean;
  v_retention_expires_at timestamptz;
begin
  select * into v_old from public.social_posts post
  where post.id=p_post_id and post.author_profile_id=p_author_profile_id
    and post.status='visible' and post.mutation_version=p_expected_mutation_version
  for update;
  if v_old.id is null then return; end if;
  if v_old.kind is distinct from p_kind then v_fields := array_append(v_fields,'kind'); end if;
  if v_old.visibility is distinct from p_visibility then v_fields := array_append(v_fields,'visibility'); end if;
  if v_old.body is distinct from p_body then v_fields := array_append(v_fields,'body'); end if;
  if v_old.area_slug is distinct from p_area_slug then v_fields := array_append(v_fields,'area'); end if;
  if v_old.venue_id is distinct from p_venue_id then v_fields := array_append(v_fields,'venue'); end if;
  if v_old.hashtags is distinct from p_hashtags then v_fields := array_append(v_fields,'hashtags'); end if;
  if v_old.comment_policy is distinct from p_comment_policy then v_fields := array_append(v_fields,'commentPolicy'); end if;
  if v_old.photo_media_id is distinct from p_photo_media_id then v_fields := array_append(v_fields,'photo'); end if;
  if v_old.photo_alt_text is distinct from p_photo_alt_text then v_fields := array_append(v_fields,'photoAltText'); end if;
  if cardinality(v_fields)=0 then return next v_old; return; end if;
  v_moderation_changed := v_old.kind is distinct from p_kind
    or v_old.body is distinct from p_body
    or v_old.hashtags is distinct from p_hashtags
    or v_old.photo_media_id is distinct from p_photo_media_id
    or v_old.photo_alt_text is distinct from p_photo_alt_text;
  update public.social_posts post set
    kind=p_kind, visibility=p_visibility, body=p_body, area_slug=p_area_slug,
    venue_id=p_venue_id, hashtags=p_hashtags, comment_policy=p_comment_policy,
    photo_media_id=p_photo_media_id, photo_alt_text=p_photo_alt_text,
    feature_status=case when p_kind='feature_request' then coalesce(post.feature_status,'submitted') else null end,
    feature_staff_response=case when p_kind='feature_request' then post.feature_staff_response else null end,
    revision=post.revision + case when p_content_changed then 1 else 0 end,
    mutation_version=post.mutation_version + 1,
    edited_at=case when p_content_changed then now() else post.edited_at end,
    moderation_state=case when v_moderation_changed then 'pending' else post.moderation_state end,
    moderated_at=case when v_moderation_changed then null else post.moderated_at end,
    updated_at=now()
  where post.id=v_old.id returning * into v_new;
  insert into public.social_post_edit_audit(
    post_id,actor_profile_id,from_mutation_version,to_mutation_version,changed_fields,previous_digest,next_digest
  ) values (
    v_new.id,p_author_profile_id,v_old.mutation_version,v_new.mutation_version,v_fields,
    public.social_post_digest(v_old),public.social_post_digest(v_new)
  );
  if v_old.visibility is distinct from v_new.visibility
    and v_old.photo_media_id is not distinct from v_new.photo_media_id
  then
    insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
    select id,p_author_profile_id,'audience_change' from public.social_post_tag_proposals
    where post_id=v_new.id and media_id=v_new.photo_media_id and state='approved';
    update public.social_post_tag_proposals set state='proposed',decided_at=null,
      audience_visibility=null,audience_revision=null,audience_shown_at=null
    where post_id=v_new.id and media_id=v_new.photo_media_id and state='approved';
  end if;
  if v_old.photo_media_id is distinct from v_new.photo_media_id then
    insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
    select id,p_author_profile_id,'cancel' from public.social_post_tag_proposals
    where post_id=v_new.id and media_id=v_old.photo_media_id and state in ('proposed','approved');
    update public.social_post_tag_proposals set state='cancelled',decided_at=now()
    where post_id=v_new.id and media_id=v_old.photo_media_id and state in ('proposed','approved');
    v_retention_expires_at := now()+interval '30 days';
    update public.social_post_media set attachment_state='detached',retention_expires_at=v_retention_expires_at,
      cleanup_token=null,cleanup_lease_until=null,updated_at=now()
    where id=v_old.photo_media_id;
    if v_old.photo_media_id is not null then
      insert into public.social_post_media_lifecycle_events(
        media_id,post_id,actor_profile_id,action,retention_expires_at
      ) values (v_old.photo_media_id,v_new.id,p_author_profile_id,'detached',v_retention_expires_at);
    end if;
  end if;
  return next v_new;
end;
$$;

create table public.social_post_remove_requests (
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(author_profile_id,idempotency_key)
);

create function public.remove_social_post_idempotent(p_post_id uuid,p_author_profile_id uuid,p_expected_mutation_version integer,p_idempotency_key text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_post public.social_posts; v_retention_expires_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_author_profile_id::text || ':remove:' || p_idempotency_key,0));
  if exists(select 1 from public.social_post_remove_requests where author_profile_id=p_author_profile_id and idempotency_key=p_idempotency_key) then
    if exists(select 1 from public.social_post_remove_requests where author_profile_id=p_author_profile_id and idempotency_key=p_idempotency_key and post_id=p_post_id) then return true; end if;
    raise exception 'idempotency conflict';
  end if;
  select * into v_post from public.social_posts where id=p_post_id and author_profile_id=p_author_profile_id
    and status='visible' and mutation_version=p_expected_mutation_version for update;
  if v_post.id is null then return false; end if;
  insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
    select id,p_author_profile_id,'cancel' from public.social_post_tag_proposals where post_id=p_post_id and state in ('proposed','approved');
  update public.social_post_tag_proposals set state='cancelled',decided_at=now() where post_id=p_post_id and state in ('proposed','approved');
  update public.social_posts set status='removed',photo_media_id=null,photo_alt_text=null,mutation_version=mutation_version+1,edited_at=now(),updated_at=now() where id=p_post_id;
  delete from public.social_post_moderation_jobs where post_id=p_post_id;
  v_retention_expires_at := now()+interval '30 days';
  update public.social_post_media set attachment_state='detached',retention_expires_at=v_retention_expires_at,
    cleanup_token=null,cleanup_lease_until=null,updated_at=now() where id=v_post.photo_media_id;
  if v_post.photo_media_id is not null then
    insert into public.social_post_media_lifecycle_events(
      media_id,post_id,actor_profile_id,action,retention_expires_at
    ) values (v_post.photo_media_id,p_post_id,p_author_profile_id,'detached',v_retention_expires_at);
  end if;
  insert into public.social_post_edit_audit(post_id,actor_profile_id,from_mutation_version,to_mutation_version,changed_fields,previous_digest,next_digest)
    select p_post_id,p_author_profile_id,v_post.mutation_version,v_post.mutation_version+1,
      array['status'] || case when v_post.photo_media_id is null then '{}'::text[] else array['photo','photoAltText'] end,
      public.social_post_digest(v_post),public.social_post_digest(post)
    from public.social_posts post where id=p_post_id;
  insert into public.social_post_remove_requests values(p_author_profile_id,p_idempotency_key,p_post_id,now());
  return true;
end; $$;

create function public.edit_social_post_with_media(
  p_post_id uuid, p_author_profile_id uuid, p_expected_mutation_version integer,
  p_kind text, p_visibility text, p_body text, p_area_slug text, p_venue_id text,
  p_hashtags text[], p_comment_policy text, p_photo_media_id uuid, p_photo_alt_text text,
  p_content_changed boolean, p_object_key text, p_sha256 text, p_width integer,
  p_height integer, p_byte_size integer, p_tag_handles text[]
)
returns setof public.social_posts language plpgsql security definer set search_path=public as $$
declare v_post public.social_posts; v_target record; v_upload public.social_post_media_uploads;
begin
  if p_photo_media_id is null or p_object_key is null or p_sha256 is null
    or p_width is null or p_height is null or p_byte_size is null or p_photo_alt_text is null
    or cardinality(coalesce(p_tag_handles,'{}')) > 10 then raise exception 'invalid Social photo edit'; end if;
  select * into v_upload from public.social_post_media_uploads upload
    where upload.media_id=p_photo_media_id and upload.owner_profile_id=p_author_profile_id
      and upload.object_key=p_object_key and upload.sha256=p_sha256 and upload.width=p_width
      and upload.height=p_height and upload.byte_size=p_byte_size and upload.state='staged'
    for update;
  if v_upload.media_id is null then raise exception 'invalid Social photo reservation'; end if;
  insert into public.social_post_media(id,generation,owner_profile_id,object_key,sha256,width,height,byte_size)
  values(p_photo_media_id,v_upload.generation,p_author_profile_id,p_object_key,p_sha256,p_width,p_height,p_byte_size);
  delete from public.social_post_media_uploads where media_id=p_photo_media_id;
  select * into v_post from public.edit_social_post(p_post_id,p_author_profile_id,p_expected_mutation_version,
    p_kind,p_visibility,p_body,p_area_slug,p_venue_id,p_hashtags,p_comment_policy,
    p_photo_media_id,p_photo_alt_text,p_content_changed);
  if v_post.id is null then raise exception 'edit conflict'; end if;
  for v_target in select profile.id from public.profiles profile
    where lower(profile.handle)=any(coalesce(p_tag_handles,'{}')) and profile.id<>p_author_profile_id
      and not public.social_interaction_blocked(p_author_profile_id,profile.id)
  loop
    insert into public.social_post_tag_proposals(post_id,media_id,author_profile_id,target_profile_id)
    values(v_post.id,p_photo_media_id,p_author_profile_id,v_target.id) returning id,target_profile_id into v_target;
    insert into public.social_post_tag_events(proposal_id,actor_profile_id,action) values(v_target.id,p_author_profile_id,'propose');
    insert into public.social_notifications(recipient_profile_id,actor_profile_id,kind,source_post_id,source_content_id)
    values(v_target.target_profile_id,p_author_profile_id,'tag_proposal',v_post.id,v_target.id) on conflict do nothing;
  end loop;
  if (select count(*) from public.social_post_tag_proposals where post_id=v_post.id and media_id=p_photo_media_id)
      <> cardinality(coalesce(p_tag_handles,'{}')) then raise exception 'invalid Social tags'; end if;
  return next v_post;
end; $$;

drop function public.claim_social_post_moderation_jobs(integer);
create function public.claim_social_post_moderation_jobs(p_limit integer default 20)
returns table(post_id uuid, revision integer, media_id uuid, object_key text, moderation_claim text, attempts integer, lease_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'invalid moderation batch size'; end if;
  return query
  with candidates as (
    select job.post_id from public.social_post_moderation_jobs job
    join public.social_posts post on post.id=job.post_id
    where post.status='visible' and post.moderation_state='pending' and (
      (job.state='pending' and job.next_attempt_at<=now())
      or (job.state='processing' and job.lease_until<now())
    ) order by job.next_attempt_at,job.created_at for update of job skip locked limit p_limit
  ), claimed as (
    update public.social_post_moderation_jobs job set state='processing',attempts=job.attempts+1,
      lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid(),updated_at=now()
    from candidates where job.post_id=candidates.post_id
    returning job.post_id,job.revision,job.media_id,job.moderation_claim,job.attempts,job.lease_token
  )
  select claimed.post_id,claimed.revision,claimed.media_id,media.object_key,
    claimed.moderation_claim,claimed.attempts,claimed.lease_token
  from claimed left join public.social_post_media media on media.id=claimed.media_id;
end;
$$;

drop function public.complete_social_post_moderation_job(uuid,integer,text,text,timestamptz);
create function public.complete_social_post_moderation_job(
  p_post_id uuid,
  p_revision integer,
  p_media_id uuid,
  p_lease_token uuid,
  p_decision text default null,
  p_error_code text default null,
  p_retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_job public.social_post_moderation_jobs; v_post public.social_posts; v_media public.social_post_media;
begin
  if p_decision in ('approved','needs_review') then
    select * into v_job from public.social_post_moderation_jobs job where job.post_id=p_post_id
      and job.revision=p_revision and job.media_id is not distinct from p_media_id
      and job.lease_token=p_lease_token and job.state='processing' for update;
    if v_job.post_id is null then return false; end if;
    select * into v_post from public.social_posts post where post.id=p_post_id and post.revision=p_revision
      and post.moderation_state='pending' and post.photo_media_id is not distinct from p_media_id for update;
    if v_post.id is null then return false; end if;
    if p_media_id is not null then
      select * into v_media from public.social_post_media where id=p_media_id and attachment_state='active' for update;
      if v_media.id is null then return false; end if;
    end if;
    update public.social_post_moderation_jobs set state='done',lease_until=null,lease_token=null,last_error_code=null,updated_at=now()
    where post_id=v_job.post_id and revision=v_job.revision
      and media_id is not distinct from v_job.media_id and lease_token=p_lease_token and state='processing';
    if not found then return false; end if;
    update public.social_posts set moderation_state=p_decision,moderated_at=now(),updated_at=now() where id=p_post_id;
    if p_media_id is not null then update public.social_post_media set moderation_state=p_decision,updated_at=now() where id=p_media_id; end if;
    return true;
  end if;
  if p_decision is not null then raise exception 'invalid moderation decision'; end if;
  update public.social_post_moderation_jobs set
    state=case when p_retry_at is null then 'error' else 'pending' end,
    next_attempt_at=coalesce(p_retry_at,next_attempt_at),lease_until=null,lease_token=null,
    last_error_code=left(coalesce(p_error_code,'provider_error'),80),updated_at=now()
  where post_id=p_post_id and revision=p_revision and media_id is not distinct from p_media_id
    and lease_token=p_lease_token and state='processing';
  return found;
end;
$$;

-- Audience approve gate uses content revision (not mutation_version): tags bind to
-- the words/photo the approver saw. Visibility-only mutations re-queue tags via
-- edit_social_post audience_change, so mutation_version is the wrong token here.
create function public.act_social_post_tag(
  p_actor uuid,p_proposal_id uuid,p_action text,p_expected_audience_revision integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_proposal public.social_post_tag_proposals; v_post public.social_posts; v_next text;
begin
  select * into v_proposal from public.social_post_tag_proposals where id=p_proposal_id for update;
  if v_proposal.id is null then raise exception 'tag not found'; end if;
  select * into v_post from public.social_posts where id=v_proposal.post_id for update;
  if v_post.id is null then raise exception 'tag not found'; end if;
  if p_action in ('approve','decline') and p_actor=v_proposal.target_profile_id and v_proposal.state='proposed' then
    if p_action='approve' and (p_expected_audience_revision is null or v_post.revision<>p_expected_audience_revision)
      then raise exception 'tag audience changed'; end if;
    v_next := case when p_action='approve' then 'approved' else 'declined' end;
  elsif p_action='withdraw' and p_actor=v_proposal.target_profile_id and v_proposal.state='approved' then
    v_next := 'withdrawn';
  elsif p_action='cancel' and p_actor=v_proposal.author_profile_id and v_proposal.state in ('proposed','approved') then
    v_next := 'cancelled';
  elsif p_actor=v_proposal.target_profile_id and ((p_action='approve' and v_proposal.state='approved')
    or (p_action='decline' and v_proposal.state='declined')
    or (p_action='withdraw' and v_proposal.state='withdrawn')) then return true;
  elsif p_actor=v_proposal.author_profile_id and p_action='cancel' and v_proposal.state='cancelled' then return true;
  else raise exception 'tag action not allowed'; end if;
  if p_action='approve' and public.social_interaction_blocked(v_proposal.author_profile_id,v_proposal.target_profile_id)
    then raise exception 'tag action not allowed'; end if;
  update public.social_post_tag_proposals set state=v_next,decided_at=now(),
    audience_visibility=case when p_action='approve' then v_post.visibility else audience_visibility end,
    audience_revision=case when p_action='approve' then v_post.revision else audience_revision end,
    audience_shown_at=case when p_action='approve' then now() else audience_shown_at end
  where id=v_proposal.id;
  insert into public.social_post_tag_events(proposal_id,actor_profile_id,action)
  values (v_proposal.id,p_actor,p_action);
  return true;
end;
$$;

create function public.read_social_post_tags(p_viewer uuid,p_post_id uuid)
returns table(proposal_id uuid,handle text)
language sql
stable
security definer
set search_path = public
as $$
  select proposal.id,profile.handle from public.social_post_tag_proposals proposal
  join public.social_posts post on post.id=proposal.post_id
  join public.profiles profile on profile.id=proposal.target_profile_id
  where proposal.post_id=p_post_id and proposal.state='approved'
    and post.photo_media_id=proposal.media_id
    and proposal.audience_visibility=post.visibility
    and public.social_post_readable(post,p_viewer)
    and not public.social_interaction_blocked(p_viewer,post.author_profile_id)
    and not public.social_interaction_blocked(p_viewer,proposal.target_profile_id)
    and not public.social_interaction_blocked(post.author_profile_id,proposal.target_profile_id);
$$;

create function public.read_social_post_tags_many(p_viewer uuid,p_post_ids uuid[])
returns table(post_id uuid,proposal_id uuid,handle text)
language sql
stable
security definer
set search_path = public
as $$
  select proposal.post_id,proposal.id,profile.handle
  from public.social_post_tag_proposals proposal
  join public.social_posts post on post.id=proposal.post_id
  join public.profiles profile on profile.id=proposal.target_profile_id
  where proposal.post_id=any(p_post_ids) and proposal.state='approved'
    and post.photo_media_id=proposal.media_id
    and proposal.audience_visibility=post.visibility
    and public.social_post_readable(post,p_viewer)
    and not public.social_interaction_blocked(p_viewer,post.author_profile_id)
    and not public.social_interaction_blocked(p_viewer,proposal.target_profile_id)
    and not public.social_interaction_blocked(post.author_profile_id,proposal.target_profile_id);
$$;

create function public.read_social_tag_inbox(
  p_viewer uuid,p_lane text,p_before_created_at timestamptz default null,
  p_before_id uuid default null,p_limit integer default 20
)
returns table(
  proposal_id uuid,post_id uuid,media_id uuid,author_handle text,state text,
  visibility text,photo_alt_text text,audience_visibility text,
  review_revision integer,audience_revision integer,audience_shown_at timestamptz,created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_lane not in ('proposed','approved') or p_limit<1 or p_limit>51
    or ((p_before_created_at is null) <> (p_before_id is null))
  then raise exception 'invalid tag inbox request'; end if;
  return query select proposal.id,proposal.post_id,
    case when post.status='visible' and post.moderation_state='approved'
      and not public.social_interaction_blocked(p_viewer,post.author_profile_id)
      and post.photo_media_id=proposal.media_id
      and media.moderation_state='approved' and media.attachment_state='active'
      then proposal.media_id else null end,
    author.handle,proposal.state,
    case when proposal.state='approved' then proposal.audience_visibility else post.visibility end,
    case when post.status='visible' and post.moderation_state='approved'
      and not public.social_interaction_blocked(p_viewer,post.author_profile_id)
      and post.photo_media_id=proposal.media_id
      and media.moderation_state='approved' and media.attachment_state='active'
      then post.photo_alt_text else null end,
    proposal.audience_visibility,
    post.revision,proposal.audience_revision,proposal.audience_shown_at,proposal.created_at
  from public.social_post_tag_proposals proposal
  join public.social_posts post on post.id=proposal.post_id
  join public.profiles author on author.id=proposal.author_profile_id
  left join public.social_post_media media on media.id=proposal.media_id
  where proposal.target_profile_id=p_viewer and proposal.state=p_lane
    and (p_before_created_at is null or (proposal.created_at,proposal.id)<(p_before_created_at,p_before_id))
    and (p_lane='approved' or (
      post.status='visible' and post.moderation_state='approved'
      and media.moderation_state='approved' and media.attachment_state='active'
      and post.photo_media_id=proposal.media_id
      and not public.social_interaction_blocked(p_viewer,post.author_profile_id)
    ))
  order by proposal.created_at desc,proposal.id desc limit p_limit;
end;
$$;

create function public.read_social_post_media(p_viewer uuid,p_media_id uuid)
returns table(object_key text)
language sql
stable
security definer
set search_path = public
as $$
  select media.object_key from public.social_post_media media
  join public.social_posts post on post.photo_media_id=media.id
  where media.id=p_media_id and media.moderation_state='approved' and media.attachment_state='active'
    and post.status='visible' and post.moderation_state='approved' and (
      public.social_post_readable(post,p_viewer)
      or exists (select 1 from public.social_post_tag_proposals proposal
        where proposal.post_id=post.id and proposal.media_id=media.id
          and proposal.target_profile_id=p_viewer and proposal.state in ('proposed','approved'))
    )
    and not public.social_interaction_blocked(p_viewer,post.author_profile_id);
$$;

create function public.read_social_post_outbox(
  p_owner uuid,p_before_created_at timestamptz default null,
  p_before_id uuid default null,p_limit integer default 20
)
returns setof public.social_posts
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_limit<1 or p_limit>51 or ((p_before_created_at is null) <> (p_before_id is null))
    then raise exception 'invalid outbox request'; end if;
  return query select post.* from public.social_posts post
  where post.author_profile_id=p_owner and post.status='visible'
    and (p_before_created_at is null or (post.created_at,post.id)<(p_before_created_at,p_before_id))
  order by post.created_at desc,post.id desc limit p_limit;
end;
$$;

create function public.read_social_post_moderation_queue(p_actor uuid,p_limit integer default 20)
returns table(staff_display_name text,post_id uuid,media_id uuid,moderation_claim text,created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  if p_limit<1 or p_limit>50 then raise exception 'invalid moderation queue size'; end if;
  select * into v_staff from public.private_social_staff_roles
  where profile_id=p_actor and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return query select v_staff.display_name,post.id,post.photo_media_id,job.moderation_claim,post.created_at
  from public.social_posts post join public.social_post_moderation_jobs job on job.post_id=post.id
  where post.moderation_state='needs_review'
    or exists (select 1 from public.social_post_media media where media.id=post.photo_media_id and media.moderation_state='needs_review')
  order by post.created_at,post.id limit p_limit;
end;
$$;

create function public.moderate_social_post(p_actor uuid,p_post_id uuid,p_media_id uuid,p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles; v_post public.social_posts;
begin
  select * into v_staff from public.private_social_staff_roles
  where profile_id=p_actor and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action not in ('approve','hide') then raise exception 'invalid moderation action'; end if;
  select * into v_post from public.social_posts where id=p_post_id for update;
  if v_post.id is null or v_post.photo_media_id is distinct from p_media_id
    or v_post.moderation_state<>'needs_review' then raise exception 'held post not found'; end if;
  update public.social_posts set moderation_state=case when p_action='approve' then 'approved' else 'needs_review' end,
    status=case when p_action='hide' then 'hidden' else status end,moderated_at=now(),updated_at=now()
  where id=v_post.id;
  if p_media_id is not null then update public.social_post_media set
    moderation_state=case when p_action='approve' then 'approved' else 'needs_review' end,updated_at=now()
    where id=p_media_id; end if;
  insert into public.social_post_moderation_actions(staff_role_id,post_id,media_id,action)
  values (v_staff.id,p_post_id,p_media_id,p_action);
  return true;
end;
$$;

alter table public.social_post_media enable row level security;
alter table public.social_post_media_uploads enable row level security;
alter table public.social_post_edit_audit enable row level security;
alter table public.social_post_media_lifecycle_events enable row level security;
alter table public.social_post_create_requests enable row level security;
alter table public.social_post_remove_requests enable row level security;
alter table public.social_post_tag_proposals enable row level security;
alter table public.social_post_tag_events enable row level security;
alter table public.social_post_moderation_actions enable row level security;

revoke all on table public.social_post_media,public.social_post_media_uploads,public.social_post_edit_audit,public.social_post_media_lifecycle_events,public.social_post_create_requests,public.social_post_remove_requests,
  public.social_post_tag_proposals,public.social_post_tag_events,public.social_post_moderation_actions
  from public,anon,authenticated;
grant select,insert,update,delete on table public.social_post_media,public.social_post_media_uploads,public.social_post_edit_audit,public.social_post_media_lifecycle_events,public.social_post_create_requests,public.social_post_remove_requests,
  public.social_post_tag_proposals,public.social_post_tag_events,public.social_post_moderation_actions
  to service_role;

revoke all on function public.reject_social_append_only_change() from public,anon,authenticated;
revoke all on function public.guard_social_post_photo_owner() from public,anon,authenticated;
revoke all on function public.guard_social_post_tag_proposal() from public,anon,authenticated;
revoke all on function public.social_post_digest(public.social_posts) from public,anon,authenticated;
revoke all on function public.social_post_exact_venue_allowed(public.social_posts,uuid) from public,anon,authenticated;
revoke all on function public.reserve_social_post_media_upload(uuid,uuid,text,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.claim_social_post_media_upload_cleanup(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_social_post_media_upload_cleanup_batch(integer,timestamptz) from public,anon,authenticated;
revoke all on function public.finalize_social_post_media_upload_cleanup(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.claim_social_post_media_cleanup_batch(integer) from public,anon,authenticated;
revoke all on function public.finalize_social_post_media_cleanup(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_social_post(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[]) from public,anon,authenticated;
revoke all on function public.create_social_post_idempotent(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[],text,text) from public,anon,authenticated;
revoke all on function public.remove_social_post_idempotent(uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.edit_social_post_with_media(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean,text,text,integer,integer,integer,text[]) from public,anon,authenticated;
revoke all on function public.complete_social_post_moderation_job(uuid,integer,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.act_social_post_tag(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.read_social_post_tags(uuid,uuid) from public,anon,authenticated;
revoke all on function public.read_social_post_tags_many(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.read_social_tag_inbox(uuid,text,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.read_social_post_media(uuid,uuid) from public,anon,authenticated;
revoke all on function public.read_social_post_outbox_item(uuid,uuid) from public,anon,authenticated;
revoke all on function public.read_social_post_outbox(uuid,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.read_social_post_moderation_queue(uuid,integer) from public,anon,authenticated;
revoke all on function public.moderate_social_post(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.set_social_comment_policy(uuid,uuid,text) from service_role;

grant execute on function public.social_post_digest(public.social_posts),
  public.social_post_exact_venue_allowed(public.social_posts,uuid),
  public.reserve_social_post_media_upload(uuid,uuid,text,integer,integer,integer),
  public.claim_social_post_media_upload_cleanup(uuid,uuid,uuid),
  public.claim_social_post_media_upload_cleanup_batch(integer,timestamptz),
  public.finalize_social_post_media_upload_cleanup(uuid,uuid,uuid),
  public.claim_social_post_media_cleanup_batch(integer),
  public.finalize_social_post_media_cleanup(uuid,uuid,uuid),
  public.create_social_post(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[]),
  public.create_social_post_idempotent(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[],text,text),
  public.remove_social_post_idempotent(uuid,uuid,integer,text),
  public.edit_social_post_with_media(uuid,uuid,integer,text,text,text,text,text,text[],text,uuid,text,boolean,text,text,integer,integer,integer,text[]),
  public.complete_social_post_moderation_job(uuid,integer,uuid,uuid,text,text,timestamptz),
  public.act_social_post_tag(uuid,uuid,text,integer),public.read_social_post_tags(uuid,uuid),
  public.read_social_post_tags_many(uuid,uuid[]),
  public.read_social_tag_inbox(uuid,text,timestamptz,uuid,integer),public.read_social_post_media(uuid,uuid),
  public.read_social_post_outbox_item(uuid,uuid),
  public.read_social_post_outbox(uuid,timestamptz,uuid,integer),public.read_social_post_moderation_queue(uuid,integer),
  public.moderate_social_post(uuid,uuid,uuid,text)
  to service_role;
