-- Ledger reconciliation: this index is already live in production (applied
-- 2026-08-27 from PR #1237, which then closed unmerged). The guard below
-- no-ops on data the index already governs; see 0127's header.

-- One account represents one membership in a Plan. The claim RPC already
-- checks this rule for a clear conflict outcome; this index also closes the
-- concurrent-writer race at the database boundary.

-- Do not silently choose a seat when legacy data already has more than one
-- stamped membership for the same account. Child tables may still refer to
-- either member, so an automatic delete or unstamp would lose ownership or
-- provenance. Stop before the index changes the schema and give the operator a
-- deterministic conflict to reconcile before rerunning this migration.
do $$
declare
  duplicate_membership record;
begin
  select plan_id, user_id, count(*) as member_count
    into duplicate_membership
  from public.plan_crew_members
  where user_id is not null
  group by plan_id, user_id
  having count(*) > 1
  order by plan_id, user_id
  limit 1;

  if found then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'legacy duplicate stamped Plan membership: plan_id=%s user_id=%s (%s rows)',
        duplicate_membership.plan_id,
        duplicate_membership.user_id,
        duplicate_membership.member_count
      ),
      detail = 'No rows were changed. Reconcile this membership group before rerunning the migration.',
      hint = 'Keep one member row per Plan and account, then rerun this migration.';
  end if;
end;
$$;

create unique index if not exists plan_crew_members_plan_user_unique_idx
  on public.plan_crew_members(plan_id, user_id)
  where user_id is not null;
