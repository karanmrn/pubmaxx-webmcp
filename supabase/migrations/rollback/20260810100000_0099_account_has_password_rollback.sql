-- Rollback 0099: drop the has-password read.
--
-- Nothing depends on it staying: `accountHasPassword` in
-- `lib/handlePasswordSignIn.ts` is tri-state, so a missing function answers
-- "could not tell" and the account hub falls back to a heading that claims
-- neither state. No data is lost, because the function stored nothing.

begin;

drop function if exists public.account_has_password(uuid);

commit;
