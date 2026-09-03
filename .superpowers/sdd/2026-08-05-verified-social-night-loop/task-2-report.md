# Task 2 report: product identity and adult-verification policy

## Status

Round 2 review findings resolved. Original implementation commit `731d2a0b`,
round 1 correction `736aee1f`, and round 1 evidence commit `e53cccd83` provide
the five-state Social access policy, protected product-account ownership,
dual-session migration, private assurance evidence storage, and exact Social
API middleware scope. Round 2 correction `ecddfe6f` replaces creation-time
ownership provenance with atomic account-owned handle creation and moves the
disabled-beta gate ahead of both identity providers.

Social remains preview-only by default. Yoti integration is not active. This
task ships only service-only evidence storage and fail-closed policy that a
future authenticated provider integration may populate.

## Architecture

- `profiles.user_id` is the sole profile ownership authority. Generic
  `ensure(handle)` creates an unowned row that can never become account-owned.
  No creation timestamp or transient state grants ownership.
- `ProfileStore.createOwned(handle, userId)` is the only new-ownership
  operation. Memory creates the record without suspending between its absence
  check and insert. Supabase delegates to the service-only
  `claim_pubmaxx_handle` transaction, which locks the handle, refuses every
  existing profile, and inserts an absent handle with `user_id` already set.
- `ProfileStore.linkUser(handle, userId)` confirms current ownership only. Same
  owner retry succeeds; absent, unowned, and differently owned rows refuse.
- Canonical onboarding uses the atomic operation. Memory and Supabase
  availability treat aliases and raw profile rows as taken, so an unaliased
  generic row is never advertised as claimable.
- `POST /api/social/access` evaluates the shared invite-beta policy before
  calling `verifyCallerAuth(request)`. When enabled, Supabase identity is
  verified at the route and Clerk identity is verified separately in the
  protected server seam. No handle, email, account ID, or ownership proxy is
  accepted from the body.
- Migration `0071` adds only service-private Social account, audit, and minimal
  Yoti-shaped evidence tables plus hardened account and handle RPCs. It does
  not add a second profile ownership state.
- `proxy.ts` matches only `/api/social/:path*`. Half-configured Clerk still uses
  the plain security proxy. `lib/clerkIdentity.ts` remains untouched because PR
  #726 owns it.

## Review findings resolved

Round 1:

1. Privacy, terms, and this report say Yoti processing is deferred. No surface
   claims a hosted check, callback, or authoritative result currently runs.
2. Disabled Social migration returns 403 and performs no Clerk or storage work.
3. Profile, redaction, deletion, and visibility callers use explicit trusted
   account fixtures rather than relying on generic profile creation.
4. `migrate_social_product_account` acquires advisory identity locks and
   existing product-account row locks in deterministic order. Twelve crossed
   clients exercise the deployed function concurrently.
5. Memory handle claims reconstruct same-owner identity from the durable
   profile row after alias-cache loss.

Round 2:

1. Generic `ensure` rows are permanently unowned. Authenticated ownership is
   created atomically only for absent handles. The rejected `ephemeral`
   authority and its redundant database column are gone.
2. Disabled POST returns before Supabase verification as well as before Clerk
   and storage work.
3. Supabase availability now checks raw profiles after aliases, closing the
   false-available response for generic rows.
4. Concurrent same-handle, same-owner/different-handle, and generic-ensure
   races run against PostgreSQL. Unique user-ID races preserve
   `already_has_handle`; handle collisions preserve `taken`.
5. Gate conflicts use errors emitted by the real atomic operation. A caller
   that already owns another handle receives 409 rather than a storage 503.

## TDD evidence

Red evidence captured before corrections:

- Initial round 2 attack set: 7 failures and 16 passes. A generic ensured row
  transferred to an attacker, `createOwned` did not exist, absent `linkUser`
  created ownership, and disabled POST invoked the Supabase verifier.
- PostgreSQL accepted the rejected `ephemeral` state.
- Supabase availability returned `available: true` for an unaliased profile.
- Concurrent different-handle claims for one owner returned `taken` instead of
  `already_has_handle` in memory and PostgreSQL.
- A signed-in caller that already owned another handle received 503 at the
  shared gate instead of a conflict response.
- First complete-suite candidate exposed an unrelated 20-second timeout in a
  test that ran two full validation subprocesses. Isolated runtime was 9.27s;
  splitting missing-registry and mismatched-registry behaviours removed the
  combined budget hazard without increasing the timeout.

Green evidence:

- Ownership attacker and trusted creation probes: 18/18.
- Social route and server policy: 14/14.
- Supabase unaliased-profile availability: 2/2.
- PostgreSQL migration, applied-migration checksum, handle races, account
  migration, private grants, assurance shape, and rollback: 10/10 in 12.99s.
- Changed caller regression set: 283/283 across 22 files before the final race
  additions.
- Split validation timeout probe: 2/2 in 5.30s.
- Reviewer re-check: PASS after the deterministic generic-writer-first race
  proved the claimant blocks, returns `taken`, leaves one row, and preserves a
  null `user_id`.

## Final verification

- `npm test`: 763/763 files and 7,732/7,732 tests passed in 235.41s.
- `npm run typecheck`: passed with no TypeScript errors.
- `npm run lint`: exited 0 with no errors. It reported 29 existing warnings in
  files outside this change.
- `git diff --check`: passed.
- Applied migration `0009_auth_ownership.sql`: no working-tree diff and pinned
  checksum passed.

## Migration note

Captain applies migrations. This task did not apply SQL to production. Suffix
`0071` remains reserved because PR #726 owns `0070`; Task 3 owns `0072`.
Applied migration `0009_auth_ownership.sql` remains byte-identical to branch
history, with SHA-256
`089e555753d5abec31c794bab4a9fef76f1ced6c4b988f68f7f82db2552fd93b`
pinned in the migration test. Migration `0071` owns the forward function
override. Its rollback removes Task 2 private Social state and restores the
prior historical handle-claim function.

## Concerns and follow-on boundary

- No Yoti hosted-session, result, or webhook endpoint exists. A later provider
  integration needs an official signed fixture, authenticated server results,
  replay deduplication, product-account binding, and the same no-document,
  no-selfie, no-DOB, no-estimated-age, no-raw-payload storage boundary.
- Social beta remains off by default. Missing or half-configured Clerk and
  missing private storage cannot open Social content or account migration.
- Migration `0071` must land with this runtime because it hardens
  `claim_pubmaxx_handle` and creates the private Social tables the server reads.
