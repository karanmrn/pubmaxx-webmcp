-- Account-owned PUBMAXX identity and server-only external social connections.
-- Additive: existing profiles/handles are preserved and backfilled as current aliases.

alter table public.profiles
  add column if not exists handle_changed_at timestamptz;

create unique index if not exists profiles_handle_lower_unique
  on public.profiles (lower(handle));

create table if not exists public.profile_handle_aliases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  handle text not null,
  is_current boolean not null default true,
  claimed_at timestamptz not null default now(),
  retired_at timestamptz,
  -- New claims are validated more strictly by the RPC. The table accepts
  -- historic 1–2 character aliases so this additive migration never strands
  -- an existing profile.
  constraint profile_handle_aliases_format_chk
    check (handle = lower(handle) and char_length(handle) between 1 and 30),
  constraint profile_handle_aliases_retired_chk
    check ((is_current and retired_at is null) or (not is_current and retired_at is not null))
);

create unique index if not exists profile_handle_aliases_handle_lower_unique
  on public.profile_handle_aliases (lower(handle));
create unique index if not exists profile_handle_aliases_one_current
  on public.profile_handle_aliases (profile_id) where is_current;
create index if not exists profile_handle_aliases_profile_idx
  on public.profile_handle_aliases (profile_id);

insert into public.profile_handle_aliases (profile_id, handle, is_current)
select id, lower(handle), true from public.profiles
on conflict do nothing;

alter table public.profile_handle_aliases enable row level security;
revoke all on public.profile_handle_aliases from public, anon, authenticated;

create or replace function public.claim_pubmaxx_handle(p_user_id uuid, p_handle text)
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
    return jsonb_build_object('ok', false, 'code', 'invalid', 'error', 'Choose a valid PUBMAXX handle.');
  end if;
  if v_handle in ('admin','api','help','moderation','official','pubmaxx','pubmaxxer','pubmaxxing','root','safety','staff','support','system')
     or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$' then
    return jsonb_build_object('ok', false, 'code', 'reserved', 'error', 'That handle is reserved.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));

  select * into v_profile from public.profiles where user_id = p_user_id limit 1;
  if found then
    insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, lower(v_profile.handle), true) on conflict do nothing;
    if lower(v_profile.handle) = v_handle then
      return jsonb_build_object('ok', true, 'profile_id', v_profile.id, 'handle', v_handle);
    end if;
    return jsonb_build_object('ok', false, 'code', 'already_has_handle', 'error', 'Rename your existing PUBMAXX handle instead.');
  end if;

  if exists (select 1 from public.profile_handle_aliases where lower(handle) = v_handle) then
    return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
  end if;

  select * into v_profile from public.profiles where lower(handle) = v_handle limit 1 for update;
  if found then
    if v_profile.user_id is not null and v_profile.user_id <> p_user_id then
      return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
    end if;
    update public.profiles set user_id = p_user_id, handle = v_handle, updated_at = now()
      where id = v_profile.id returning * into v_profile;
  else
    insert into public.profiles(user_id, handle) values (p_user_id, v_handle)
      returning * into v_profile;
  end if;
  insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, v_handle, true) on conflict do nothing;
  return jsonb_build_object('ok', true, 'profile_id', v_profile.id, 'handle', v_handle);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
end;
$$;

create or replace function public.rename_pubmaxx_handle(p_user_id uuid, p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_profile public.profiles%rowtype;
  v_previous text;
  v_retry_at timestamptz;
begin
  if p_user_id is null or v_handle !~ '^[a-z0-9_]{3,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'error', 'Choose a valid PUBMAXX handle.');
  end if;
  if v_handle in ('admin','api','help','moderation','official','pubmaxx','pubmaxxer','pubmaxxing','root','safety','staff','support','system')
     or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$' then
    return jsonb_build_object('ok', false, 'code', 'reserved', 'error', 'That handle is reserved.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));
  select * into v_profile from public.profiles where user_id = p_user_id limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Claim a PUBMAXX handle first.');
  end if;
  v_previous := lower(v_profile.handle);
  if v_previous = v_handle then
    return jsonb_build_object('ok', true, 'profile_id', v_profile.id, 'previous_handle', v_previous, 'handle', v_handle);
  end if;
  v_retry_at := v_profile.handle_changed_at + interval '30 days';
  if v_profile.handle_changed_at is not null and now() < v_retry_at then
    return jsonb_build_object('ok', false, 'code', 'cooldown', 'error', 'You can rename your handle once every 30 days.', 'retry_at', v_retry_at);
  end if;
  if exists (select 1 from public.profile_handle_aliases where lower(handle) = v_handle)
     or exists (select 1 from public.profiles where lower(handle) = v_handle) then
    return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
  end if;
  update public.profile_handle_aliases set is_current = false, retired_at = now()
    where profile_id = v_profile.id and is_current;
  insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, v_handle, true);
  update public.profiles set handle = v_handle, handle_changed_at = now(), updated_at = now()
    where id = v_profile.id;
  return jsonb_build_object('ok', true, 'profile_id', v_profile.id, 'previous_handle', v_previous, 'handle', v_handle);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
end;
$$;

revoke all on function public.claim_pubmaxx_handle(uuid, text) from public, anon, authenticated;
revoke all on function public.rename_pubmaxx_handle(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_pubmaxx_handle(uuid, text) to service_role;
grant execute on function public.rename_pubmaxx_handle(uuid, text) to service_role;

-- Opaque, one-time OAuth state. The browser receives only the random nonce;
-- account ownership and the PKCE verifier remain server-side.
create table if not exists public.social_oauth_states (
  nonce_hash text primary key check (char_length(nonce_hash) = 64),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('x','instagram','tiktok')),
  redirect_uri text not null,
  code_verifier text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists social_oauth_states_expiry_idx
  on public.social_oauth_states(expires_at);
alter table public.social_oauth_states enable row level security;
revoke all on public.social_oauth_states from public, anon, authenticated;

create or replace function public.consume_social_oauth_state(p_nonce_hash text, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.social_oauth_states%rowtype;
begin
  update public.social_oauth_states
  set consumed_at = now()
  where nonce_hash = p_nonce_hash
    and provider = p_provider
    and consumed_at is null
    and expires_at > now()
  returning * into candidate;
  if not found then return null; end if;
  return jsonb_build_object(
    'owner_id', candidate.owner_id,
    'redirect_uri', candidate.redirect_uri,
    'code_verifier', candidate.code_verifier
  );
end;
$$;

revoke all on function public.consume_social_oauth_state(text, text) from public, anon, authenticated;
grant execute on function public.consume_social_oauth_state(text, text) to service_role;

create table if not exists public.external_social_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('x','instagram','tiktok')),
  mode text not null check (mode in ('oauth','manual')),
  account_kind text not null check (account_kind in ('personal','professional')),
  provider_account_id text,
  username text,
  profile_url text,
  scopes text[] not null default '{}',
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider),
  constraint external_social_mode_chk check (
    (mode = 'manual' and provider = 'instagram' and account_kind = 'personal' and access_token_ciphertext is null)
    or (mode = 'oauth' and access_token_ciphertext is not null and provider_account_id is not null)
  )
);

create index if not exists external_social_accounts_owner_idx
  on public.external_social_accounts(owner_id);
create unique index if not exists external_social_provider_account_unique
  on public.external_social_accounts(provider, provider_account_id)
  where provider_account_id is not null;

alter table public.external_social_accounts enable row level security;
revoke all on public.external_social_accounts from public, anon, authenticated;
