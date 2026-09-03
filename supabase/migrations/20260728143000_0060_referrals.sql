-- Private referral attribution and reward audit spine.
--
-- Account ids come only from verified Supabase Auth JWTs. Invite codes and
-- referral codes are opaque.
-- Contribution qualification is intentionally callable only by service_role
-- and has no route until contribution rows carry authenticated user ids.

create extension if not exists "pgcrypto";

create table if not exists public.referral_erasure_blocks (
  user_id_hash text primary key,
  erased_at timestamptz not null default now(),
  constraint referral_erasure_blocks_hash_chk
    check (user_id_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.referral_invite_codes (
  inviter_user_id uuid primary key,
  code_hash text not null unique,
  code_token text not null,
  created_at timestamptz not null default now(),
  constraint referral_invite_codes_hash_chk
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint referral_invite_codes_token_chk
    check (char_length(code_token) between 20 and 80)
);

create table if not exists public.referral_edges (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null,
  invitee_user_id uuid not null unique,
  attributed_at timestamptz not null default now(),
  constraint referral_edges_not_self_chk
    check (inviter_user_id <> invitee_user_id)
);

create index if not exists referral_edges_inviter_idx
  on public.referral_edges (inviter_user_id, attributed_at);

create table if not exists public.referral_qualification_events (
  id uuid primary key default gen_random_uuid(),
  edge_id uuid not null unique references public.referral_edges(id),
  contribution_kind text not null
    check (contribution_kind in ('community_price', 'visit_report', 'recommendation')),
  contribution_id text not null,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (contribution_kind, contribution_id)
);

create table if not exists public.pro_feature_unlock_ledger (
  id uuid primary key default gen_random_uuid(),
  beneficiary_user_id uuid not null,
  event_type text not null check (event_type in ('milestone_earned', 'feature_granted')),
  feature_key text not null check (
    feature_key in (
      'collaborative_night_credit',
      'continuing_memories',
      'post_trial_collaboration'
    )
  ),
  milestone integer not null check (milestone in (1, 3, 5)),
  permanent boolean not null default true check (permanent),
  grant_status text not null check (grant_status in ('blocked_identity', 'granted')),
  reason_code text not null check (reason_code = 'qualified_referrals'),
  triggering_edge_id uuid not null references public.referral_edges(id),
  qualified_count_at_event integer not null check (qualified_count_at_event >= milestone),
  created_at timestamptz not null default now(),
  constraint referral_ledger_event_status_chk check (
    (event_type = 'milestone_earned' and grant_status = 'blocked_identity')
    or
    (event_type = 'feature_granted' and grant_status = 'granted')
  ),
  unique (beneficiary_user_id, event_type, milestone)
);

create index if not exists referral_ledger_beneficiary_idx
  on public.pro_feature_unlock_ledger (beneficiary_user_id, created_at);

alter table public.referral_invite_codes enable row level security;
alter table public.referral_erasure_blocks enable row level security;
alter table public.referral_edges enable row level security;
alter table public.referral_qualification_events enable row level security;
alter table public.pro_feature_unlock_ledger enable row level security;

revoke all on public.referral_invite_codes from public, anon, authenticated;
revoke all on public.referral_erasure_blocks from public, anon, authenticated;
revoke all on public.referral_edges from public, anon, authenticated;
revoke all on public.referral_qualification_events from public, anon, authenticated;
revoke all on public.pro_feature_unlock_ledger from public, anon, authenticated;

create or replace function public.referral_append_only_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('pubmaxx.referral_erasure', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name;
end;
$$;

drop trigger if exists referral_edges_append_only on public.referral_edges;
create trigger referral_edges_append_only
before update or delete on public.referral_edges
for each row execute function public.referral_append_only_guard();

drop trigger if exists referral_qualifications_append_only
  on public.referral_qualification_events;
create trigger referral_qualifications_append_only
before update or delete on public.referral_qualification_events
for each row execute function public.referral_append_only_guard();

drop trigger if exists referral_ledger_append_only
  on public.pro_feature_unlock_ledger;
create trigger referral_ledger_append_only
before update or delete on public.pro_feature_unlock_ledger
for each row execute function public.referral_append_only_guard();

create or replace function public.referral_grant_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.event_type = 'feature_granted'
     and current_setting('pubmaxx.referral_grants_enabled', true)
       is distinct from 'on' then
    raise exception 'referral feature grants are disabled';
  end if;
  return new;
end;
$$;

drop trigger if exists referral_grant_insert_gate
  on public.pro_feature_unlock_ledger;
create trigger referral_grant_insert_gate
before insert on public.pro_feature_unlock_ledger
for each row execute function public.referral_grant_insert_guard();

create or replace function public.get_or_create_referral_invite_code(
  p_inviter_user_id uuid,
  p_code_hash text,
  p_code_token text,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.referral_invite_codes%rowtype;
begin
  if p_inviter_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_user');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_inviter_user_id::text, 0)
  );
  if exists (
    select 1 from public.referral_erasure_blocks
    where user_id_hash = encode(digest(p_inviter_user_id::text, 'sha256'), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'deleted_identity');
  end if;

  insert into public.referral_invite_codes (
    inviter_user_id,
    code_hash,
    code_token,
    created_at
  )
  values (
    p_inviter_user_id,
    p_code_hash,
    p_code_token,
    p_created_at
  )
  on conflict (inviter_user_id) do nothing;

  select * into candidate
  from public.referral_invite_codes
  where inviter_user_id = p_inviter_user_id;

  return jsonb_build_object('ok', true, 'code', candidate.code_token);
end;
$$;

create or replace function public.record_referral_edge(
  p_inviter_user_id uuid,
  p_invitee_user_id uuid,
  p_attributed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.referral_edges%rowtype;
begin
  if p_inviter_user_id is null or p_invitee_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'storage');
  end if;
  if p_inviter_user_id = p_invitee_user_id then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(p_inviter_user_id::text, p_invitee_user_id::text), 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(greatest(p_inviter_user_id::text, p_invitee_user_id::text), 0)
  );

  if exists (
    select 1 from public.referral_erasure_blocks
    where user_id_hash in (
      encode(digest(p_inviter_user_id::text, 'sha256'), 'hex'),
      encode(digest(p_invitee_user_id::text, 'sha256'), 'hex')
    )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'deleted_identity');
  end if;

  select * into candidate
  from public.referral_edges
  where invitee_user_id = p_invitee_user_id;

  if found then
    if candidate.inviter_user_id = p_inviter_user_id then
      return jsonb_build_object(
        'ok', true,
        'status', 'existing',
        'edge_id', candidate.id
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_attributed');
  end if;

  if exists (
    select 1
    from public.referral_edges
    where inviter_user_id = p_invitee_user_id
      and invitee_user_id = p_inviter_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'circular');
  end if;

  insert into public.referral_edges (
    inviter_user_id,
    invitee_user_id,
    attributed_at
  )
  values (
    p_inviter_user_id,
    p_invitee_user_id,
    p_attributed_at
  )
  returning * into candidate;

  return jsonb_build_object(
    'ok', true,
    'status', 'recorded',
    'edge_id', candidate.id
  );
end;
$$;

create or replace function public.claim_referral_code(
  p_code_hash text,
  p_invitee_user_id uuid,
  p_auth_attempt_started_at timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inviter uuid;
  invitee_created_at timestamptz;
begin
  if p_invitee_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'storage');
  end if;
  select created_at into invitee_created_at
  from auth.users
  where id = p_invitee_user_id;

  if invitee_created_at is null
     or p_auth_attempt_started_at is null
     or p_auth_attempt_started_at > p_now
     or p_auth_attempt_started_at <= p_now - interval '1 hour'
     or invitee_created_at > p_now
     or invitee_created_at < p_auth_attempt_started_at then
    return jsonb_build_object(
      'ok', false,
      'reason', 'account_not_new'
    );
  end if;

  select inviter_user_id into inviter
  from public.referral_invite_codes
  where code_hash = p_code_hash;

  if inviter is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  return public.record_referral_edge(
    inviter,
    p_invitee_user_id,
    p_now
  );
end;
$$;

create or replace function public.qualify_referral_from_contribution(
  p_invitee_user_id uuid,
  p_contribution_kind text,
  p_contribution_id text,
  p_accepted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  edge public.referral_edges%rowtype;
  inserted_id uuid;
  qualified_count integer;
  milestone integer;
  feature_key text;
  triggering_edge_id uuid;
begin
  if p_invitee_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'storage');
  end if;
  if p_contribution_kind not in (
    'community_price',
    'visit_report',
    'recommendation'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'storage');
  end if;

  select * into edge
  from public.referral_edges
  where invitee_user_id = p_invitee_user_id;

  if not found then
    perform pg_advisory_xact_lock(
      hashtextextended(p_invitee_user_id::text, 0)
    );
    if exists (
      select 1 from public.referral_erasure_blocks
      where user_id_hash = encode(
        digest(p_invitee_user_id::text, 'sha256'),
        'hex'
      )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'deleted_identity');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no_edge');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(least(edge.inviter_user_id::text, p_invitee_user_id::text), 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(greatest(edge.inviter_user_id::text, p_invitee_user_id::text), 0)
  );

  select * into edge
  from public.referral_edges
  where invitee_user_id = p_invitee_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_edge');
  end if;
  if exists (
    select 1 from public.referral_erasure_blocks
    where user_id_hash in (
      encode(digest(edge.inviter_user_id::text, 'sha256'), 'hex'),
      encode(digest(p_invitee_user_id::text, 'sha256'), 'hex')
    )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'deleted_identity');
  end if;

  insert into public.referral_qualification_events (
    edge_id,
    contribution_kind,
    contribution_id,
    accepted_at
  )
  values (
    edge.id,
    p_contribution_kind,
    p_contribution_id,
    p_accepted_at
  )
  on conflict (edge_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return jsonb_build_object('ok', true, 'status', 'existing');
  end if;

  select count(*)::integer into qualified_count
  from public.referral_qualification_events qualification
  join public.referral_edges referred_edge
    on referred_edge.id = qualification.edge_id
  where referred_edge.inviter_user_id = edge.inviter_user_id;

  for milestone, feature_key in
    select *
    from (
      values
        (1, 'collaborative_night_credit'),
        (3, 'continuing_memories'),
        (5, 'post_trial_collaboration')
    ) as rewards(milestone, feature_key)
    where qualified_count >= rewards.milestone
  loop
    select qualification.edge_id into triggering_edge_id
    from public.referral_qualification_events qualification
    join public.referral_edges referred_edge
      on referred_edge.id = qualification.edge_id
    where referred_edge.inviter_user_id = edge.inviter_user_id
    order by qualification.accepted_at, qualification.id
    offset milestone - 1
    limit 1;

    insert into public.pro_feature_unlock_ledger (
      beneficiary_user_id,
      event_type,
      feature_key,
      milestone,
      permanent,
      grant_status,
      reason_code,
      triggering_edge_id,
      qualified_count_at_event,
      created_at
    )
    values (
      edge.inviter_user_id,
      'milestone_earned',
      feature_key,
      milestone,
      true,
      'blocked_identity',
      'qualified_referrals',
      triggering_edge_id,
      qualified_count,
      p_accepted_at
    )
    on conflict (beneficiary_user_id, event_type, milestone) do nothing;
  end loop;

  return jsonb_build_object('ok', true, 'status', 'qualified');
end;
$$;

create or replace function public.read_private_referral_status(
  p_inviter_user_id uuid
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with counts as (
    select
      count(distinct edge.id)::integer as attributed_count,
      count(qualification.id)::integer as qualified_count
    from public.referral_edges edge
    left join public.referral_qualification_events qualification
      on qualification.edge_id = edge.id
    where edge.inviter_user_id = p_inviter_user_id
  ),
  earned as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event', ledger.event_type,
          'feature', ledger.feature_key,
          'milestone', ledger.milestone,
          'permanent', ledger.permanent,
          'grantStatus', ledger.grant_status,
          'earnedAt', ledger.created_at,
          'qualifiedCount', ledger.qualified_count_at_event
        )
        order by ledger.milestone
      ),
      '[]'::jsonb
    ) as rows
    from public.pro_feature_unlock_ledger ledger
    where ledger.beneficiary_user_id = p_inviter_user_id
      and ledger.event_type = 'milestone_earned'
  )
  select jsonb_build_object(
    'attributed_count', counts.attributed_count,
    'qualified_count', counts.qualified_count,
    'earned', earned.rows
  )
  from counts cross join earned;
$$;

-- Explicit erasure path. Ordinary writes remain append-only, while a verified
-- account-erasure request can remove private referral data in one transaction.
create or replace function public.erase_referral_account(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  insert into public.referral_erasure_blocks (user_id_hash)
  values (encode(digest(p_user_id::text, 'sha256'), 'hex'))
  on conflict (user_id_hash) do nothing;

  perform set_config('pubmaxx.referral_erasure', 'on', true);

  delete from public.pro_feature_unlock_ledger
  where beneficiary_user_id = p_user_id
     or triggering_edge_id in (
       select id from public.referral_edges
       where inviter_user_id = p_user_id or invitee_user_id = p_user_id
     );

  delete from public.referral_qualification_events
  where edge_id in (
    select id from public.referral_edges
    where inviter_user_id = p_user_id or invitee_user_id = p_user_id
  );

  delete from public.referral_edges
  where inviter_user_id = p_user_id or invitee_user_id = p_user_id;

  delete from public.referral_invite_codes
  where inviter_user_id = p_user_id;
end;
$$;

revoke all on function public.get_or_create_referral_invite_code(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.record_referral_edge(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_referral_code(
  text, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.qualify_referral_from_contribution(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.read_private_referral_status(
  uuid
) from public, anon, authenticated;
revoke all on function public.erase_referral_account(
  uuid
) from public, anon, authenticated;

grant execute on function public.get_or_create_referral_invite_code(
  uuid, text, text, timestamptz
) to service_role;
grant execute on function public.record_referral_edge(
  uuid, uuid, timestamptz
) to service_role;
grant execute on function public.claim_referral_code(
  text, uuid, timestamptz, timestamptz
) to service_role;
grant execute on function public.qualify_referral_from_contribution(
  uuid, text, text, timestamptz
) to service_role;
grant execute on function public.read_private_referral_status(
  uuid
) to service_role;
grant execute on function public.erase_referral_account(
  uuid
) to service_role;
