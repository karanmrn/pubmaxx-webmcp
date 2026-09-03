begin;

drop function if exists public.recover_plan_account_membership_atomic(
  uuid, uuid, text, text, text, timestamptz
);
drop index if exists public.plan_crew_members_recovery_key_idx;
alter table public.plan_crew_members
  drop constraint if exists plan_members_recovery_key_hash_format,
  drop constraint if exists plan_members_recovery_request_hash_format,
  drop column if exists recovery_key_hash,
  drop column if exists recovery_request_hash;

commit;
