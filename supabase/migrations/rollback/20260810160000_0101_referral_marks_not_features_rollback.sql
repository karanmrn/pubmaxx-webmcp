-- Rollback for 0101: restore the referral feature-grant model.
--
-- Lossless for every row 0101 kept: a milestone row's `feature_key` is a pure
-- function of its milestone, and every surviving row's grant status was
-- `blocked_identity` (0101 deleted the `feature_granted` rows, of which there
-- were none, because the gate never opened). The gate goes back closed.

alter table public.referral_milestone_ledger
  rename to pro_feature_unlock_ledger;
alter index if exists referral_milestone_ledger_beneficiary_idx
  rename to referral_ledger_beneficiary_idx;

-- The append-only guard refuses the backfill below, so it comes off first and
-- goes back on once the retired columns are populated.
drop trigger if exists referral_ledger_append_only
  on public.pro_feature_unlock_ledger;

alter table public.pro_feature_unlock_ledger
  add column if not exists feature_key text;
alter table public.pro_feature_unlock_ledger
  add column if not exists grant_status text;

update public.pro_feature_unlock_ledger
set feature_key = case milestone
      when 1 then 'collaborative_night_credit'
      when 3 then 'continuing_memories'
      when 5 then 'post_trial_collaboration'
    end
where feature_key is null;

update public.pro_feature_unlock_ledger
set grant_status = 'blocked_identity'
where grant_status is null;

alter table public.pro_feature_unlock_ledger
  alter column feature_key set not null;
alter table public.pro_feature_unlock_ledger
  alter column grant_status set not null;

alter table public.pro_feature_unlock_ledger
  drop constraint if exists referral_milestone_ledger_event_type_check;
alter table public.pro_feature_unlock_ledger
  add constraint pro_feature_unlock_ledger_event_type_check
  check (event_type in ('milestone_earned', 'feature_granted'));
alter table public.pro_feature_unlock_ledger
  add constraint pro_feature_unlock_ledger_feature_key_check
  check (
    feature_key in (
      'collaborative_night_credit',
      'continuing_memories',
      'post_trial_collaboration'
    )
  );
alter table public.pro_feature_unlock_ledger
  add constraint pro_feature_unlock_ledger_grant_status_check
  check (grant_status in ('blocked_identity', 'granted'));
alter table public.pro_feature_unlock_ledger
  add constraint referral_ledger_event_status_chk check (
    (event_type = 'milestone_earned' and grant_status = 'blocked_identity')
    or
    (event_type = 'feature_granted' and grant_status = 'granted')
  );

revoke all on public.pro_feature_unlock_ledger from public, anon, authenticated;
grant select, insert, update, delete
  on table public.pro_feature_unlock_ledger to service_role;

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

drop trigger if exists referral_ledger_append_only
  on public.pro_feature_unlock_ledger;
create trigger referral_ledger_append_only
before update or delete on public.pro_feature_unlock_ledger
for each row execute function public.referral_append_only_guard();

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
  -- Renamed from 0060's `milestone`, which collided with the ledger column of
  -- that name and made `on conflict (..., milestone)` raise "column reference
  -- is ambiguous". 0060's spelling was never executed (no route calls this
  -- seam), so restoring the defect alongside the grant model would restore a
  -- function that cannot run. The grant model is what a rollback owes.
  milestone_value integer;
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

  for milestone_value, feature_key in
    select rewards.milestone, rewards.feature_key
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
    offset milestone_value - 1
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
      milestone_value,
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
