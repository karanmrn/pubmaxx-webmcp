-- Account-bound contributor identity and private profile fields.
--
-- Public identity stays in profiles. Private signup fields live in a separate
-- table with no public grants.

create table if not exists public.private_account_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date not null,
  full_name text,
  sex text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_identity_full_name_check
    check (full_name is null or char_length(full_name) between 1 and 100),
  constraint private_identity_sex_check
    check (
      sex is null
      or sex in ('female', 'male', 'intersex', 'prefer_not_to_say')
    )
);

alter table public.private_account_identities enable row level security;
revoke all on public.private_account_identities
  from public, anon, authenticated;

-- Legacy profiles were created by self-declared handles and already have a
-- current alias row. Claim that exact unlinked profile in place. A retired
-- alias or a profile linked to another auth account remains unavailable.
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
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid',
      'error', 'Choose a valid PUBMAXX handle.'
    );
  end if;
  if v_handle in (
    'admin', 'api', 'help', 'moderation', 'official', 'pubmaxx',
    'pubmaxxer', 'pubmaxxing', 'root', 'safety', 'staff', 'support', 'system'
  )
  or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$'
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'reserved',
      'error', 'That handle is reserved.'
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));

  select *
    into v_profile
    from public.profiles
   where user_id = p_user_id
   limit 1;
  if found then
    insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, lower(v_profile.handle), true)
    on conflict do nothing;
    if lower(v_profile.handle) = v_handle then
      return jsonb_build_object(
        'ok', true,
        'profile_id', v_profile.id,
        'handle', v_handle
      );
    end if;
    return jsonb_build_object(
      'ok', false,
      'code', 'already_has_handle',
      'error', 'Rename your existing PUBMAXX handle instead.'
    );
  end if;

  select *
    into v_profile
    from public.profiles
   where lower(handle) = v_handle
   limit 1
   for update;

  if found then
    if exists (
      select 1
        from public.profile_handle_aliases
       where lower(handle) = v_handle
         and profile_id <> v_profile.id
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'taken',
        'error', 'That handle is already taken.'
      );
    end if;
    if v_profile.user_id is not null and v_profile.user_id <> p_user_id then
      return jsonb_build_object(
        'ok', false,
        'code', 'taken',
        'error', 'That handle is already taken.'
      );
    end if;
    update public.profiles
       set user_id = p_user_id,
           handle = v_handle,
           updated_at = now()
     where id = v_profile.id
     returning * into v_profile;
  else
    if exists (
      select 1
        from public.profile_handle_aliases
       where lower(handle) = v_handle
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'taken',
        'error', 'That handle is already taken.'
      );
    end if;
    insert into public.profiles(user_id, handle)
    values (p_user_id, v_handle)
    returning * into v_profile;
  end if;

  insert into public.profile_handle_aliases(profile_id, handle, is_current)
  values (v_profile.id, v_handle, true)
  on conflict do nothing;

  return jsonb_build_object(
    'ok', true,
    'profile_id', v_profile.id,
    'handle', v_handle
  );
exception when unique_violation then
  return jsonb_build_object(
    'ok', false,
    'code', 'taken',
    'error', 'That handle is already taken.'
  );
end;
$$;

revoke all on function public.claim_pubmaxx_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_pubmaxx_handle(uuid, text)
  to service_role;

create or replace function public.complete_contributor_onboarding(
  p_user_id uuid,
  p_handle text,
  p_date_of_birth date,
  p_full_name text default null,
  p_sex text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim jsonb;
begin
  v_claim := public.claim_pubmaxx_handle(p_user_id, p_handle);
  if coalesce(v_claim->>'ok', 'false') <> 'true' then
    return v_claim;
  end if;

  insert into public.private_account_identities (
    user_id,
    date_of_birth,
    full_name,
    sex,
    updated_at
  )
  values (
    p_user_id,
    p_date_of_birth,
    nullif(trim(p_full_name), ''),
    p_sex,
    now()
  )
  on conflict (user_id) do update
    set full_name = coalesce(
          excluded.full_name,
          public.private_account_identities.full_name
        ),
        sex = coalesce(
          excluded.sex,
          public.private_account_identities.sex
        ),
        updated_at = now();

  return v_claim;
end;
$$;

revoke all on function public.complete_contributor_onboarding(
  uuid,
  text,
  date,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.complete_contributor_onboarding(
  uuid,
  text,
  date,
  text,
  text
) to service_role;
