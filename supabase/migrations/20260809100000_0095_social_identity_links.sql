-- Every social connectable (0095).
-- external_social_accounts (migration 0029) held three providers and allowed a
-- manual row for Instagram alone. A linked social is now the owner's own public
-- handle on any of ten services, typed in rather than handshaken, so:
--   * widen the provider CHECK to the closed set in lib/socialConnections.ts;
--   * allow a manual row for every provider, still personal and still with no
--     credential material attached.
-- The OAuth arm of the constraint is unchanged: a handshake still has to carry
-- a ciphertext and a provider account id. Captain / firstmate applies.

begin;

alter table public.external_social_accounts
  drop constraint if exists external_social_accounts_provider_check;

alter table public.external_social_accounts
  add constraint external_social_accounts_provider_check
  check (provider in (
    'x','instagram','tiktok','youtube','letterboxd',
    'spotify','snapchat','strava','linkedin','website'
  ));

alter table public.external_social_accounts
  drop constraint if exists external_social_mode_chk;

alter table public.external_social_accounts
  add constraint external_social_mode_chk check (
    (mode = 'manual' and account_kind = 'personal' and access_token_ciphertext is null)
    or (mode = 'oauth' and access_token_ciphertext is not null and provider_account_id is not null)
  );

commit;
