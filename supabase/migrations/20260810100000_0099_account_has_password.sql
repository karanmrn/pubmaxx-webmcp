-- Account has a password (0099): one boolean, so a signed-in owner can be told
-- whether to CREATE a password or CHANGE one.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHY A FUNCTION AT ALL: `auth.users.encrypted_password` lives in the `auth`
-- schema, which PostgREST does not expose, and GoTrue's admin user object
-- carries no password field. Without this the account hub could only guess, and
-- a surface that guesses would tell a person who HAS a password to create one.
--
-- WHAT IT RETURNS: true or false. Never the hash, never its length, never the
-- day it was set. The caller learns one bit about one account.
--
-- WHO MAY CALL IT: the service role alone. It is SECURITY DEFINER, so EXECUTE
-- is revoked from `public`, `anon` and `authenticated` first and granted back to
-- `service_role` only. A browser role that could ask this of any user id would
-- have an oracle for which accounts carry a password, which is a map for
-- somebody choosing where to spend guesses. The one caller is
-- `lib/handlePasswordSignIn.ts`, on the owner's own id, behind
-- `/api/identity/handle/current`, which authenticates the caller first.
--
-- `search_path` is pinned empty so every name inside resolves schema-qualified:
-- a SECURITY DEFINER function that resolves names through a caller's
-- `search_path` is how a definer's rights get borrowed.

begin;

create or replace function public.account_has_password(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and u.encrypted_password is not null
      and u.encrypted_password <> ''
  );
$$;

comment on function public.account_has_password(uuid) is
  'True when the account carries a password in Supabase auth. Returns one boolean and never the hash. Service role only: a browser-callable version would be an oracle for which accounts have passwords.';

revoke all on function public.account_has_password(uuid) from public;
revoke all on function public.account_has_password(uuid) from anon;
revoke all on function public.account_has_password(uuid) from authenticated;
grant execute on function public.account_has_password(uuid) to service_role;

commit;
