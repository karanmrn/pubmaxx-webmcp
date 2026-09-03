-- 0101: a referral milestone is a MARK OF HONOUR, never a feature grant.
--
-- Captain decision 2026-08-10. Migration 0060 built a capability-grant model:
-- the ledger recorded a `feature_key` from a closed list of pro features, an
-- `event_type` that could be `feature_granted`, a `grant_status` of `granted`,
-- and a trigger that refused a grant while the session variable
-- `pubmaxx.referral_grants_enabled` was off. Every part of that was reachable;
-- only a flag stood between it and shipping. A closed gate is a mute button,
-- not a decision, so this removes the model rather than keeping it switched off.
--
-- What remains is recognition: an inviter reaches 1, 3 or 5 qualified referrals
-- and the ledger records that they did. Nothing in the product branches on it
-- (`lib/referrals.ts` owns the law, the same law `lib/foundingMembers.ts`
-- keeps for founding numbers). The abuse argument that closed the old gate goes
-- with the grants: somebody who games the count wins a sentence about
-- themselves and nothing else.
--
-- Deploy order does not matter. Application code after this decision reads
-- neither `feature_key` nor `grant_status`, and it projects every ledger row
-- through one shared shape (`earnedFromRow` in lib/referralStore.ts), so the
-- retired columns cannot reach a reader before this migration lands.
--
-- Rollback: supabase/migrations/rollback/20260810160000_0101_referral_marks_not_features_rollback.sql

-- The append-only trigger refuses an ordinary delete, and the retired rows have
-- to go before the check constraint narrows. There are none in production - the
-- gate never opened - so this is a belt-and-braces sweep, not a data migration.
drop trigger if exists referral_ledger_append_only
  on public.pro_feature_unlock_ledger;

delete from public.pro_feature_unlock_ledger
where event_type = 'feature_granted';

-- The grant lane itself: the gate, its guard function, and the two columns that
-- only ever described a grant.
drop trigger if exists referral_grant_insert_gate
  on public.pro_feature_unlock_ledger;
drop function if exists public.referral_grant_insert_guard();

alter table public.pro_feature_unlock_ledger
  drop constraint if exists referral_ledger_event_status_chk;
alter table public.pro_feature_unlock_ledger
  drop constraint if exists pro_feature_unlock_ledger_event_type_check;
alter table public.pro_feature_unlock_ledger
  add constraint referral_milestone_ledger_event_type_check
  check (event_type = 'milestone_earned');

alter table public.pro_feature_unlock_ledger drop column if exists feature_key;
alter table public.pro_feature_unlock_ledger drop column if exists grant_status;

-- The name was the loudest remaining claim. A ledger of marks is not a ledger
-- of unlocked features. Renaming carries the row-level security, the policies,
-- the grants and the remaining trigger with it.
alter table public.pro_feature_unlock_ledger
  rename to referral_milestone_ledger;
alter index if exists referral_ledger_beneficiary_idx
  rename to referral_milestone_ledger_beneficiary_idx;

create trigger referral_ledger_append_only
before update or delete on public.referral_milestone_ledger
for each row execute function public.referral_append_only_guard();

revoke all on public.referral_milestone_ledger from public, anon, authenticated;
grant select, insert, update, delete
  on table public.referral_milestone_ledger to service_role;

-- Every function that touched the ledger is rewritten against the new shape.
-- `search_path` is restated on purpose: create or replace drops any SET clause
-- it does not carry, and migration 0086 exists because these functions cannot
-- find pgcrypto's digest() without `extensions` on the path.

create or replace function public.qualify_referral_from_contribution(
  p_invitee_user_id uuid,
  p_contribution_kind text,
  p_contribution_id text,
  p_accepted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  edge public.referral_edges%rowtype;
  inserted_id uuid;
  qualified_count integer;
  -- Not `milestone`: the ledger has a column of that name, and a plpgsql
  -- variable sharing it makes `on conflict (..., milestone)` below raise
  -- "column reference is ambiguous". Migration 0060 declared it that way and
  -- the error was latent only because no route has ever called this seam.
  milestone_value integer;
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

  for milestone_value in
    select milestones.milestone
    from (values (1), (3), (5)) as milestones(milestone)
    where qualified_count >= milestones.milestone
  loop
    select qualification.edge_id into triggering_edge_id
    from public.referral_qualification_events qualification
    join public.referral_edges referred_edge
      on referred_edge.id = qualification.edge_id
    where referred_edge.inviter_user_id = edge.inviter_user_id
    order by qualification.accepted_at, qualification.id
    offset milestone_value - 1
    limit 1;

    insert into public.referral_milestone_ledger (
      beneficiary_user_id,
      event_type,
      milestone,
      permanent,
      reason_code,
      triggering_edge_id,
      qualified_count_at_event,
      created_at
    )
    values (
      edge.inviter_user_id,
      'milestone_earned',
      milestone_value,
      true,
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
set search_path = public, extensions, pg_temp
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
          'milestone', ledger.milestone,
          'permanent', ledger.permanent,
          'earnedAt', ledger.created_at,
          'qualifiedCount', ledger.qualified_count_at_event
        )
        order by ledger.milestone
      ),
      '[]'::jsonb
    ) as rows
    from public.referral_milestone_ledger ledger
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

create or replace function public.erase_referral_account(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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

  delete from public.referral_milestone_ledger
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

revoke all on function public.qualify_referral_from_contribution(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.read_private_referral_status(
  uuid
) from public, anon, authenticated;
revoke all on function public.erase_referral_account(
  uuid
) from public, anon, authenticated;

grant execute on function public.qualify_referral_from_contribution(
  uuid, text, text, timestamptz
) to service_role;
grant execute on function public.read_private_referral_status(
  uuid
) to service_role;
grant execute on function public.erase_referral_account(
  uuid
) to service_role;
