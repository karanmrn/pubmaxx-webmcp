-- Rollback 0095: restore migration 0029's provider set and Instagram-only
-- manual rule on external_social_accounts.
--
-- Rows added under the wider set would fail the restored constraints, so the
-- rollback removes them first. That is a real deletion of links people typed
-- in, and it is the only way back to the narrow shape.

begin;

delete from public.external_social_accounts
where provider not in ('x','instagram','tiktok');

delete from public.external_social_accounts
where mode = 'manual' and provider <> 'instagram';

alter table public.external_social_accounts
  drop constraint if exists external_social_accounts_provider_check;

alter table public.external_social_accounts
  add constraint external_social_accounts_provider_check
  check (provider in ('x','instagram','tiktok'));

alter table public.external_social_accounts
  drop constraint if exists external_social_mode_chk;

alter table public.external_social_accounts
  add constraint external_social_mode_chk check (
    (mode = 'manual' and provider = 'instagram' and account_kind = 'personal' and access_token_ciphertext is null)
    or (mode = 'oauth' and access_token_ciphertext is not null and provider_account_id is not null)
  );

commit;
