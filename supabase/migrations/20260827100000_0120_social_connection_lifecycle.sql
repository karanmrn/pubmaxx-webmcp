-- Social connection capability lifecycle. Credentials remain server-only.

alter table public.external_social_accounts
  add column if not exists refresh_status text not null default 'not_applicable',
  add column if not exists consent_version text not null default 'legacy-v1',
  add column if not exists fetched_at timestamptz,
  add column if not exists upstream_revocation_state text not null default 'not_applicable';

-- Bring existing OAuth rows into the closed lifecycle before constraints are
-- added. Legacy grants need certification again, so no capability is exposed.
update public.external_social_accounts
set refresh_status = 'refresh_due',
    consent_version = 'legacy-oauth-v1',
    fetched_at = coalesce(fetched_at, updated_at),
    upstream_revocation_state = 'unknown'
where mode = 'oauth';

update public.external_social_accounts
set refresh_status = 'not_applicable',
    consent_version = 'manual-link-v1',
    upstream_revocation_state = 'not_applicable'
where mode = 'manual';

alter table public.external_social_accounts
  drop constraint if exists external_social_accounts_refresh_status_check,
  add constraint external_social_accounts_refresh_status_check
    check (refresh_status in ('not_applicable', 'current', 'refresh_due', 'refresh_failed')),
  drop constraint if exists external_social_accounts_revocation_state_check,
  add constraint external_social_accounts_revocation_state_check
    check (upstream_revocation_state in ('not_applicable', 'active', 'unknown', 'pending', 'revoked', 'failed')),
  drop constraint if exists external_social_accounts_lifecycle_mode_check,
  add constraint external_social_accounts_lifecycle_mode_check check (
    (mode = 'manual'
      and refresh_status = 'not_applicable'
      and upstream_revocation_state = 'not_applicable')
    or
    (mode = 'oauth'
      and refresh_status in ('current', 'refresh_due', 'refresh_failed')
      and upstream_revocation_state in ('active', 'unknown', 'pending', 'revoked', 'failed'))
  );

revoke all on table public.external_social_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.external_social_accounts to service_role;

drop policy if exists external_social_accounts_owner_all on public.external_social_accounts;
drop policy if exists external_social_accounts_anon_deny on public.external_social_accounts;
