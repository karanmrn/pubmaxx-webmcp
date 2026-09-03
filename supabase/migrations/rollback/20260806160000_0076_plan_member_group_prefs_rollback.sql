-- Rollback for 0076_plan_member_group_prefs. Drops the atomic writer, then the
-- request ledger and preference rows. Captain applies.

drop function if exists public.record_plan_member_group_pref_atomic(
  uuid, uuid, text, text, boolean, boolean, boolean, text, uuid, timestamptz
);
drop table if exists public.plan_member_group_pref_requests;
drop table if exists public.plan_member_group_prefs;
