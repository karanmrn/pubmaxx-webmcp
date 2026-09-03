-- Bind an admin moderation choice to the exact held revision the moderator reviewed.
-- Keep the earlier signature during application and migration overlap, but
-- make every legacy call fail closed because it carries no reviewed revision.

create function public.moderate_social_post_admin(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_expected_revision integer,p_action text)
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
  if v_post.id is null or p_expected_revision is null
    or v_post.revision <> p_expected_revision
    or v_post.photo_media_id is distinct from p_media_id
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

revoke all on function public.moderate_social_post_admin(uuid,uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.moderate_social_post_admin(uuid,uuid,uuid,integer,text) to service_role;

create or replace function public.moderate_social_post_admin(p_staff_role_id uuid,p_post_id uuid,p_media_id uuid,p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return false;
end;
$$;

revoke all on function public.moderate_social_post_admin(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.moderate_social_post_admin(uuid,uuid,uuid,text) to service_role;
