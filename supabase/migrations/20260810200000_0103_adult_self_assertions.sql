-- Adult self-assertion (0103): one recorded tap saying "I'm 18 or over".
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHY A ROW AT ALL: the Social age check used to require a stored date of
-- birth, and an account claimed through the early handle path has no
-- `private_account_identities` row at all, so it could never pass. Captain
-- decision 2026-08-10 makes a recorded one-tap self-assertion the ordinary way
-- in. Recorded, because an assertion nobody wrote down is a claim the next
-- request cannot see.
--
-- WHY NOT A COLUMN ON `private_account_identities`: that table's
-- `date_of_birth` is NOT NULL, so the accounts this exists for are exactly the
-- ones that cannot have a row there. A separate table also keeps the fact off
-- `profiles`, whose rows are projected publicly.
--
-- WHAT IT IS NOT: a capability, and not a substitute for a date of birth. A
-- stored adult date of birth still passes on its own, and a stored date of
-- birth that says under 18 still refuses - an assertion may answer a question
-- nobody has answered, never overturn one the account already answered.
-- `lib/socialLaunch.ts` `accountIsAdult` is the one gate that says so.

begin;

create table if not exists public.adult_self_assertions (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  asserted_at timestamptz not null default now()
);

comment on table public.adult_self_assertions is
  'One row per account that tapped "I am 18 or over". Never a capability: the only thing it answers is the adult gate, beside a stored date of birth.';

alter table public.adult_self_assertions enable row level security;

-- Owner-scoped SELECT is fine for a signed-in client: an account may read its
-- own recorded assertion. The write stays service-role only, because the route
-- (`app/api/identity/adult-assertion`) is what binds the assertion to the
-- caller's own verified session.
revoke all on table public.adult_self_assertions from public, anon, authenticated;
grant select on table public.adult_self_assertions to authenticated;
grant select, insert, update, delete on table public.adult_self_assertions to service_role;

drop policy if exists adult_self_assertions_owner_select on public.adult_self_assertions;
create policy adult_self_assertions_owner_select
  on public.adult_self_assertions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists adult_self_assertions_anon_deny on public.adult_self_assertions;
create policy adult_self_assertions_anon_deny
  on public.adult_self_assertions for all to anon
  using (false) with check (false);

commit;
