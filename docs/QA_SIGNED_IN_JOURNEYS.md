# QA signed-in journeys, without a personal mailbox

QA (human or agent) often needs to verify a signed-in journey on production or
a preview deployment. The normal sign-in path sends a real email, which QA
cannot receive without a personal mailbox. This page describes the operator
tool that mints a real, one-time sign-in link instead, and how to sign in,
claim a throwaway handle, and clean up afterward.

This is an operator-side script. It adds no server route and no new attack
surface on production: it uses the Supabase admin API directly, with the same
service role key an operator already holds.

## 1. Mint a link

```
SUPABASE_SERVICE_ROLE_KEY=... \
SUPABASE_URL=... \
  node scripts/qa/mint-signin-link.mjs \
    --email qa+journey1@pubmaxxing.com \
    --base-url https://your-preview-or-prod-url
```

Notes:
- `--email` must match `qa+<anything>@pubmaxxing.com` (case-insensitive), or
  equal a `QA_TEST_EMAIL` value you set yourself. The script refuses any
  address that looks like a real production handle
  (`karan`, `karanszn`, `karanmrn`, `karanmanoharan`), regardless of pattern.
- `--base-url` is the site the link should return to: production, a preview
  deployment, or `http://localhost:3000`.
- The first time a QA address signs in, add `--type signup` (Supabase's
  default `magiclink` type needs an existing user).
- The script prints the link to stdout only. It never writes a token to a
  file or log. Copy it and use it right away: Supabase links expire, by
  default after one hour, and are one-time use.
- Add `--dry-run` to check every safety gate and see the exact request the
  script would make, without calling Supabase or minting a real link. Use
  this to test the script itself against a non-production target, or with
  `SUPABASE_SERVICE_ROLE_KEY` unset.

## 2. Sign in with the link

Open the printed link in a fresh browser (or a private window). This is the
same one-time link a real email would carry, so it lands exactly where a real
sign-in would: this app's `/auth/callback` route, which forwards you to the
app with the session established.

Because the link was minted outside any browser that "requested" it, the app
treats this the same as an email link opened in a different browser than the
one you sent it from — a supported path, not an error. You will see a
visible "Signed in as …" confirmation rather than a silent landing. This
behaviour lives in `lib/authRedirect.ts` and `components/auth/AuthProvider.tsx`.

## 3. Claim a throwaway handle

A brand-new QA sign-in has no public handle yet, so the callback lands on the
claim surface (`/u/you`, `components/identity/AccountOnboarding.tsx`). Enter
any available handle you plan to discard after the QA session (for example
`qajourney1`). Claiming the handle is what creates the account's public
`profiles` row; until then, only the private `auth.users` row exists.

## 4. Clean up the test account afterward

Do this after every QA session so throwaway handles do not pile up.

**If the journey never claimed a handle** (you stopped before step 3, or
tested only the sign-in landing): delete the `auth.users` row. That is the
whole cleanup — see the last command below.

**If the journey claimed a handle:** delete the `public.profiles` row
*before* deleting the `auth.users` row. Deleting `auth.users` first only
tombstones the profile (`profiles.tombstoned_at`, migration `0078`) and keeps
the handle permanently reserved, by design, so real accounts are never
silently freed for reuse. QA accounts should not eat handles that way.

Run with the service role, in this order:

```sql
-- 1. Find the auth user id.
select id, email from auth.users where email = 'qa+journey1@pubmaxxing.com';

-- 2. Delete the profile row for that user. This cascades to
--    profile_handle_aliases, follows, saved_pubs, and every other table
--    that references public.profiles(id) with "on delete cascade".
--    Skip this step if the journey never claimed a handle.
delete from public.profiles where user_id = '<uuid from step 1>';
```

Then delete the auth user itself. This cascades `night_profiles`,
`contributor identity` / `private_account_identities`, and any other table
keyed to `auth.users(id)` with `on delete cascade`. Use the admin API rather
than SQL here, since `auth.users` is Supabase-managed:

```js
await admin.auth.admin.deleteUser("<uuid from step 1>");
```

or delete the user from the Supabase dashboard, Authentication > Users.

Verify cleanup by re-running the query from step 1: it should return no rows,
and `select * from public.profiles where handle = 'qajourney1'` should also
return no rows.
