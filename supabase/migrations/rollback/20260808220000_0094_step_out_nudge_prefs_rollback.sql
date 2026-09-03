-- Rollback 0094: drop Step Out weekly nudge preference table and policies.

begin;

drop policy if exists step_out_nudge_prefs_anon_deny on public.step_out_nudge_prefs;
drop policy if exists step_out_nudge_prefs_owner_delete on public.step_out_nudge_prefs;
drop policy if exists step_out_nudge_prefs_owner_update on public.step_out_nudge_prefs;
drop policy if exists step_out_nudge_prefs_owner_insert on public.step_out_nudge_prefs;
drop policy if exists step_out_nudge_prefs_owner_select on public.step_out_nudge_prefs;

drop index if exists public.step_out_nudge_prefs_enabled_idx;

drop table if exists public.step_out_nudge_prefs;

commit;
