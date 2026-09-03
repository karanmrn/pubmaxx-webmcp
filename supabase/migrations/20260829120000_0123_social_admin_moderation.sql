-- Let the existing admin console consume Social's held-post queue.
-- Service-role execute is safe only behind the application admin gate.

create function public.read_social_post_moderation_queue_admin(p_staff_role_id uuid,p_limit integer default 20)
returns table(staff_display_name text,post_id uuid,media_id uuid,moderation_claim text,created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'invalid moderation queue size'; end if;
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return query select v_staff.display_name,post.id,post.photo_media_id,job.moderation_claim,post.created_at
  from public.social_posts post
  join public.social_post_moderation_jobs job on job.post_id = post.id
    and job.revision = post.revision
    and job.media_id is not distinct from post.photo_media_id
    and job.state = 'done'
  where post.status = 'visible'
    and (post.moderation_state = 'needs_review'
      or (post.moderation_state = 'approved' and exists (
        select 1 from public.social_post_media media
        where media.id = post.photo_media_id and media.moderation_state = 'needs_review'
      )))
  order by post.created_at, post.id
  limit p_limit;
end;
$$;

create function public.moderate_social_post_admin(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles; v_post public.social_posts;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action not in ('approve','hide') then raise exception 'invalid moderation action'; end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if v_post.id is null or v_post.photo_media_id is distinct from p_media_id
    or v_post.status <> 'visible' or not (
      v_post.moderation_state = 'needs_review'
      or (v_post.moderation_state = 'approved' and p_media_id is not null and exists (
        select 1 from public.social_post_media media
        where media.id = p_media_id and media.moderation_state = 'needs_review'
      ))
    )
    or not exists (
      select 1 from public.social_post_moderation_jobs job
      where job.post_id = p_post_id
        and job.revision = v_post.revision
        and job.media_id is not distinct from p_media_id
        and job.state = 'done'
    )
    then return false; end if;
  update public.social_posts set
    moderation_state = case
      when p_action = 'approve' and moderation_state = 'needs_review' then 'approved'
      when p_action = 'hide' then 'needs_review'
      else moderation_state
    end,
    status = case when p_action = 'hide' then 'hidden' else status end,
    moderated_at = now(), updated_at = now()
  where id = v_post.id;
  if p_media_id is not null then
    update public.social_post_media set
      moderation_state = case when p_action = 'approve' then 'approved' else 'needs_review' end,
      updated_at = now()
    where id = p_media_id;
  end if;
  insert into public.social_post_moderation_actions(staff_role_id,post_id,media_id,action)
  values (v_staff.id,p_post_id,p_media_id,p_action);
  return true;
end;
$$;

create function public.read_social_post_media_admin(p_staff_role_id uuid,p_media_id uuid)
returns table(object_key text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return query select media.object_key
  from public.social_post_media media
  join public.social_posts post on post.photo_media_id = media.id
  join public.social_post_moderation_jobs job on job.post_id = post.id
    and job.revision = post.revision
    and job.media_id is not distinct from post.photo_media_id
    and job.state = 'done'
  where media.id = p_media_id
    and media.attachment_state = 'active'
    and post.status = 'visible'
    and (post.moderation_state = 'needs_review' or media.moderation_state = 'needs_review');
end;
$$;

revoke all on function public.read_social_post_moderation_queue_admin(uuid,integer) from public, anon, authenticated;
revoke all on function public.moderate_social_post_admin(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.read_social_post_media_admin(uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_social_post_moderation_queue_admin(uuid,integer) to service_role;
grant execute on function public.moderate_social_post_admin(uuid,uuid,uuid,text) to service_role;
grant execute on function public.read_social_post_media_admin(uuid,uuid) to service_role;
