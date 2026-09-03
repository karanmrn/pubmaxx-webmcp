-- Roll back Social product ownership and Yoti assurance state. This deletes
-- all Task 2 Social bindings and restores the earlier legacy-handle claim path.

drop function if exists public.migrate_social_product_account(text, uuid);
drop table if exists public.private_social_age_verifications;
drop table if exists public.private_social_account_audit;
drop table if exists public.private_social_accounts;

create or replace function public.claim_pubmaxx_handle(
  p_user_id uuid,
  p_handle text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_profile public.profiles%rowtype;
begin
  if p_user_id is null or v_handle !~ '^[a-z0-9_]{3,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid',
      'error', 'Choose a valid PUBMAXX handle.');
  end if;
  if v_handle in (
    'admin', 'api', 'help', 'moderation', 'official', 'pubmaxx',
    'pubmaxxer', 'pubmaxxing', 'root', 'safety', 'staff', 'support', 'system'
  ) or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$'
  then
    return jsonb_build_object('ok', false, 'code', 'reserved',
      'error', 'That handle is reserved.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));
  select * into v_profile from public.profiles
   where user_id = p_user_id limit 1;
  if found then
    insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, lower(v_profile.handle), true)
    on conflict do nothing;
    if lower(v_profile.handle) = v_handle then
      return jsonb_build_object('ok', true, 'profile_id', v_profile.id,
        'handle', v_handle);
    end if;
    return jsonb_build_object('ok', false, 'code', 'already_has_handle',
      'error', 'Rename your existing PUBMAXX handle instead.');
  end if;

  select * into v_profile from public.profiles
   where lower(handle) = v_handle limit 1 for update;
  if found then
    if exists (
      select 1 from public.profile_handle_aliases
       where lower(handle) = v_handle and profile_id <> v_profile.id
    ) or (v_profile.user_id is not null and v_profile.user_id <> p_user_id) then
      return jsonb_build_object('ok', false, 'code', 'taken',
        'error', 'That handle is already taken.');
    end if;
    update public.profiles set user_id = p_user_id, handle = v_handle,
      updated_at = now() where id = v_profile.id returning * into v_profile;
  else
    if exists (
      select 1 from public.profile_handle_aliases where lower(handle) = v_handle
    ) then
      return jsonb_build_object('ok', false, 'code', 'taken',
        'error', 'That handle is already taken.');
    end if;
    insert into public.profiles(user_id, handle) values (p_user_id, v_handle)
    returning * into v_profile;
  end if;

  insert into public.profile_handle_aliases(profile_id, handle, is_current)
  values (v_profile.id, v_handle, true) on conflict do nothing;
  return jsonb_build_object('ok', true, 'profile_id', v_profile.id,
    'handle', v_handle);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'taken',
    'error', 'That handle is already taken.');
end;
$$;

revoke all on function public.claim_pubmaxx_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_pubmaxx_handle(uuid, text)
  to service_role;
