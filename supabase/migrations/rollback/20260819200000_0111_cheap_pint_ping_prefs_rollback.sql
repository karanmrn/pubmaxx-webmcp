-- Rollback 0111 cheap pint ping columns on step_out_nudge_prefs.

drop index if exists public.step_out_nudge_prefs_cheap_pint_ready_idx;

alter table public.step_out_nudge_prefs
  drop constraint if exists step_out_nudge_prefs_enabled_token_check;

alter table public.step_out_nudge_prefs
  drop column if exists cheap_pint_sent_at,
  drop column if exists cheap_pint_declined,
  drop column if exists cheap_pint_enabled,
  drop column if exists cheap_pint_qualified;

alter table public.step_out_nudge_prefs
  add constraint step_out_nudge_prefs_enabled_token_check
  check (
    (enabled = true and subscription_token is not null)
    or (enabled = false and subscription_token is null)
  );
