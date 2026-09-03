-- Cheap pint weekday ping preference (0111).
-- Extends step_out_nudge_prefs: one weekday 5pm web push after the first
-- completed pint drop or saved favourite pint. Ask once; decline is durable.
-- Shares subscription_token with Step Out. Captain / firstmate applies.

alter table public.step_out_nudge_prefs
  add column if not exists cheap_pint_qualified boolean not null default false,
  add column if not exists cheap_pint_enabled boolean not null default false,
  add column if not exists cheap_pint_declined boolean not null default false,
  add column if not exists cheap_pint_sent_at timestamptz;

alter table public.step_out_nudge_prefs
  drop constraint if exists step_out_nudge_prefs_enabled_token_check;

alter table public.step_out_nudge_prefs
  add constraint step_out_nudge_prefs_enabled_token_check
  check (
    (
      (enabled = true or cheap_pint_enabled = true)
      and subscription_token is not null
    )
    or (
      enabled = false
      and cheap_pint_enabled = false
      and subscription_token is null
    )
  );

create index if not exists step_out_nudge_prefs_cheap_pint_ready_idx
  on public.step_out_nudge_prefs (cheap_pint_enabled, cheap_pint_qualified)
  where cheap_pint_enabled = true
    and cheap_pint_qualified = true
    and cheap_pint_declined = false
    and cheap_pint_sent_at is null
    and subscription_token is not null;

comment on column public.step_out_nudge_prefs.cheap_pint_qualified is
  'True after the owner''s first completed pint drop or saved favourite pint.';
comment on column public.step_out_nudge_prefs.cheap_pint_enabled is
  'Opt-in for the one weekday 5pm cheap-pint ping. Default OFF.';
comment on column public.step_out_nudge_prefs.cheap_pint_declined is
  'Durable refusal — never prompt or send again.';
comment on column public.step_out_nudge_prefs.cheap_pint_sent_at is
  'When the one lifetime ping was sent. Null until sent.';
