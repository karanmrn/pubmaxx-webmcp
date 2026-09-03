-- Rollback 0103: drop the recorded adult self-assertion.
--
-- Lossy by design: the assertions themselves go with the table. Every account
-- that had also stored an adult date of birth keeps passing the gate through
-- that lane, and the rest meet the one-tap prompt again. `accountIsAdult`
-- treats a missing read as "not asserted", never as "not an adult", so nothing
-- here refuses an account it should admit for any other reason.

begin;

drop policy if exists adult_self_assertions_anon_deny on public.adult_self_assertions;
drop policy if exists adult_self_assertions_owner_select on public.adult_self_assertions;

drop table if exists public.adult_self_assertions;

commit;
