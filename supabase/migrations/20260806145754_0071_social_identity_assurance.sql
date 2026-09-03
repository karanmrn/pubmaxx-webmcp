-- Private product ownership and adult-assurance state for Social.
-- Clerk, legacy Supabase Auth and Yoti remain separate authorities. The only
-- join is this service-role-only account record. No date of birth, document,
-- image, provider payload or provider credential belongs here.

-- Every unowned profile stays unowned. Account writers create absent rows with
-- `user_id` set in the same insert, so no second provenance state can drift.

create table public.private_social_accounts (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  supabase_user_id uuid unique references auth.users(id) on delete restrict,
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  ownership_state text not null default 'active'
    check (ownership_state in ('active', 'suspended')),
  ownership_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_social_accounts_clerk_user_id_check
    check (char_length(trim(clerk_user_id)) between 1 and 255)
);

create table public.private_social_account_audit (
  id bigint generated always as identity primary key,
  product_account_id uuid not null
    references public.private_social_accounts(id) on delete cascade,
  action text not null check (action in ('migration_bound')),
  previous_supabase_user_id uuid,
  current_supabase_user_id uuid,
  changed_at timestamptz not null default now()
);

create table public.private_social_age_verifications (
  id uuid primary key default gen_random_uuid(),
  product_account_id uuid not null
    references public.private_social_accounts(id) on delete cascade,
  provider text not null check (provider = 'yoti'),
  yoti_subject_reference text not null,
  decision text not null check (decision in ('verified_adult', 'not_verified')),
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  audit_state text not null
    check (audit_state in ('current', 'superseded', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_social_age_verifications_reference_check
    check (char_length(trim(yoti_subject_reference)) between 1 and 512),
  constraint private_social_age_verifications_window_check
    check (expires_at > verified_at),
  unique (provider, yoti_subject_reference)
);

create unique index private_social_age_verifications_current_idx
  on public.private_social_age_verifications(product_account_id)
  where audit_state = 'current';

alter table public.private_social_accounts enable row level security;
alter table public.private_social_account_audit enable row level security;
alter table public.private_social_age_verifications enable row level security;

revoke all on public.private_social_accounts
  from public, anon, authenticated;
revoke all on public.private_social_account_audit
  from public, anon, authenticated;
revoke all on public.private_social_age_verifications
  from public, anon, authenticated;
grant select, insert, update, delete on public.private_social_accounts
  to service_role;
grant select, insert, update, delete on public.private_social_account_audit
  to service_role;
grant usage, select on sequence public.private_social_account_audit_id_seq
  to service_role;
grant select, insert, update, delete on public.private_social_age_verifications
  to service_role;

-- Both identifiers are supplied only by server verifiers. The function never
-- accepts a handle, email or browser account id. Advisory locks make two first
-- requests serialize, while row locks protect existing bindings.
create or replace function public.migrate_social_product_account(
  p_clerk_user_id text,
  p_supabase_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clerk_user_id text := trim(p_clerk_user_id);
  v_profile public.profiles%rowtype;
  v_clerk_account public.private_social_accounts%rowtype;
  v_supabase_account public.private_social_accounts%rowtype;
  v_locked_account public.private_social_accounts%rowtype;
  v_account public.private_social_accounts%rowtype;
  v_lock_key bigint;
begin
  if v_clerk_user_id = '' or p_supabase_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
  end if;

  -- Every migration orders both identity locks by their numeric key. Crossed
  -- requests therefore cannot acquire one identity each and wait on the other.
  for v_lock_key in
    select lock_key
      from (values
        (hashtextextended('clerk:' || v_clerk_user_id, 0)),
        (hashtextextended('supabase:' || p_supabase_user_id::text, 0))
      ) as identity_locks(lock_key)
     order by lock_key
  loop
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  select * into v_profile
    from public.profiles
   where user_id = p_supabase_user_id
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'legacy_profile_not_found');
  end if;

  -- Lock every existing product account involved in one id order, then assign
  -- its role. Separate Clerk-first and Supabase-first selects can deadlock when
  -- two already-bound accounts are crossed concurrently.
  for v_locked_account in
    select *
      from public.private_social_accounts
     where clerk_user_id = v_clerk_user_id
        or supabase_user_id = p_supabase_user_id
     order by id
     for update
  loop
    if v_locked_account.clerk_user_id = v_clerk_user_id then
      v_clerk_account := v_locked_account;
    end if;
    if v_locked_account.supabase_user_id = p_supabase_user_id then
      v_supabase_account := v_locked_account;
    end if;
  end loop;

  if v_clerk_account.id is not null then
    if v_supabase_account.id is not null
       and v_supabase_account.id <> v_clerk_account.id then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_clerk_account.profile_id <> v_profile.id
       or (
         v_clerk_account.supabase_user_id is not null
         and v_clerk_account.supabase_user_id <> p_supabase_user_id
       ) then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_clerk_account.supabase_user_id = p_supabase_user_id then
      return jsonb_build_object(
        'ok', true,
        'product_account_id', v_clerk_account.id,
        'migrated', false
      );
    end if;

    update public.private_social_accounts
       set supabase_user_id = p_supabase_user_id,
           updated_at = now(),
           ownership_changed_at = now()
     where id = v_clerk_account.id
     returning * into v_account;
  elsif v_supabase_account.id is not null then
    return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
  else
    insert into public.private_social_accounts (
      clerk_user_id,
      supabase_user_id,
      profile_id
    ) values (
      v_clerk_user_id,
      p_supabase_user_id,
      v_profile.id
    ) returning * into v_account;
  end if;

  insert into public.private_social_account_audit (
    product_account_id,
    action,
    previous_supabase_user_id,
    current_supabase_user_id
  ) values (
    v_account.id,
    'migration_bound',
    null,
    p_supabase_user_id
  );

  return jsonb_build_object(
    'ok', true,
    'product_account_id', v_account.id,
    'migrated', true
  );
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
end;
$$;

revoke all on function public.migrate_social_product_account(text, uuid)
  from public, anon, authenticated;
grant execute on function public.migrate_social_product_account(text, uuid)
  to service_role;

-- Freeze old self-declared profiles. An already-linked owner stays valid and a
-- new handle still creates a new profile, but an unlinked row can no longer be
-- turned into account ownership by first touch.
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
    return jsonb_build_object('ok', false, 'code', 'taken',
      'error', 'That handle is already taken.');
  end if;
  if exists (
    select 1 from public.profile_handle_aliases where lower(handle) = v_handle
  ) then
    return jsonb_build_object('ok', false, 'code', 'taken',
      'error', 'That handle is already taken.');
  end if;

  insert into public.profiles(user_id, handle)
  values (p_user_id, v_handle)
  returning * into v_profile;
  insert into public.profile_handle_aliases(profile_id, handle, is_current)
  values (v_profile.id, v_handle, true);
  return jsonb_build_object('ok', true, 'profile_id', v_profile.id,
    'handle', v_handle);
exception when unique_violation then
  select * into v_profile from public.profiles
   where user_id = p_user_id limit 1;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_has_handle',
      'error', 'Rename your existing PUBMAXX handle instead.');
  end if;
  return jsonb_build_object('ok', false, 'code', 'taken',
    'error', 'That handle is already taken.');
end;
$$;

revoke all on function public.claim_pubmaxx_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_pubmaxx_handle(uuid, text)
  to service_role;
