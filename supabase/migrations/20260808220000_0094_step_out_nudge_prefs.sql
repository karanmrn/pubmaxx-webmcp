-- Step Out weekly nudge preference (0094).
-- Strictly opt-in (enabled default false). One row per owner actor.
-- subscription_token binds to an existing web-push registration
-- (push_tokens / migration 0052). last_sent_at is the per-subscription
-- frequency stamp (one push per week maximum). Service-role is the app
-- write path; RLS owner-only for JWT. Captain / firstmate applies.

create table if not exists public.step_out_nudge_prefs (
  owner_actor         text primary key,
  enabled             boolean not null default false,
  subscription_token  text,
  last_sent_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'step_out_nudge_prefs_owner_actor_check'
  ) then
    alter table public.step_out_nudge_prefs
      add constraint step_out_nudge_prefs_owner_actor_check
      check (owner_actor like 'profile:%' and char_length(owner_actor) between 10 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'step_out_nudge_prefs_token_len_check'
  ) then
    alter table public.step_out_nudge_prefs
      add constraint step_out_nudge_prefs_token_len_check
      check (
        subscription_token is null
        or char_length(btrim(subscription_token)) between 1 and 2048
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'step_out_nudge_prefs_enabled_token_check'
  ) then
    alter table public.step_out_nudge_prefs
      add constraint step_out_nudge_prefs_enabled_token_check
      check (
        (enabled = true and subscription_token is not null)
        or (enabled = false and subscription_token is null)
      );
  end if;
end $$;

create index if not exists step_out_nudge_prefs_enabled_idx
  on public.step_out_nudge_prefs (enabled)
  where enabled = true and subscription_token is not null;

comment on table public.step_out_nudge_prefs is
  'Step Out weekly nudge: opt-in preference + per-subscription last_sent stamp. Default OFF.';

alter table public.step_out_nudge_prefs enable row level security;

revoke all on table public.step_out_nudge_prefs from anon, authenticated;
grant select, insert, update, delete on table public.step_out_nudge_prefs to authenticated;
grant select, insert, update, delete on table public.step_out_nudge_prefs to service_role;

drop policy if exists step_out_nudge_prefs_owner_select on public.step_out_nudge_prefs;
create policy step_out_nudge_prefs_owner_select
  on public.step_out_nudge_prefs
  for select
  to authenticated
  using (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

drop policy if exists step_out_nudge_prefs_owner_insert on public.step_out_nudge_prefs;
create policy step_out_nudge_prefs_owner_insert
  on public.step_out_nudge_prefs
  for insert
  to authenticated
  with check (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

drop policy if exists step_out_nudge_prefs_owner_update on public.step_out_nudge_prefs;
create policy step_out_nudge_prefs_owner_update
  on public.step_out_nudge_prefs
  for update
  to authenticated
  using (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  )
  with check (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

drop policy if exists step_out_nudge_prefs_owner_delete on public.step_out_nudge_prefs;
create policy step_out_nudge_prefs_owner_delete
  on public.step_out_nudge_prefs
  for delete
  to authenticated
  using (
    owner_actor like 'profile:%'
    and pubmax_private.rls_owns_profile((substring(owner_actor from 9))::uuid)
  );

drop policy if exists step_out_nudge_prefs_anon_deny on public.step_out_nudge_prefs;
create policy step_out_nudge_prefs_anon_deny
  on public.step_out_nudge_prefs
  for all
  to anon
  using (false)
  with check (false);
