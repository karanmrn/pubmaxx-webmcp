-- Auto-provision private_social_accounts from a Supabase session for the
-- friends-launch gate. Clerk remains optional; Supabase-only accounts use a
-- synthetic clerk_user_id placeholder that never collides with real Clerk ids.

create or replace function public.provision_social_product_account(
  p_supabase_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_account public.private_social_accounts%rowtype;
  v_clerk_placeholder text := 'supabase:' || p_supabase_user_id::text;
begin
  if p_supabase_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('supabase:' || p_supabase_user_id::text, 0)
  );

  select * into v_profile
    from public.profiles
   where user_id = p_supabase_user_id
   limit 1
   for update;

  if not found
     or v_profile.handle is null
     or char_length(trim(v_profile.handle)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'profile_not_claimed');
  end if;

  select * into v_account
    from public.private_social_accounts
   where supabase_user_id = p_supabase_user_id
      or profile_id = v_profile.id
   order by id
   limit 1
   for update;

  if v_account.id is not null then
    if v_account.profile_id <> v_profile.id then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_account.supabase_user_id is not null
       and v_account.supabase_user_id <> p_supabase_user_id then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_account.supabase_user_id is null then
      update public.private_social_accounts
         set supabase_user_id = p_supabase_user_id,
             updated_at = now(),
             ownership_changed_at = now()
       where id = v_account.id;
    end if;
    return jsonb_build_object(
      'ok', true,
      'product_account_id', v_account.id,
      'provisioned', false
    );
  end if;

  insert into public.private_social_accounts (
    clerk_user_id,
    supabase_user_id,
    profile_id
  ) values (
    v_clerk_placeholder,
    p_supabase_user_id,
    v_profile.id
  ) returning * into v_account;

  return jsonb_build_object(
    'ok', true,
    'product_account_id', v_account.id,
    'provisioned', true
  );
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
end;
$$;

revoke all on function public.provision_social_product_account(uuid)
  from public, anon, authenticated;
grant execute on function public.provision_social_product_account(uuid)
  to service_role;
