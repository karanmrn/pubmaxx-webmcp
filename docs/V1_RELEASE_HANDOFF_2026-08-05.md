# PubMaxxing V1 release handoff

Date: 5 August 2026

Branch: `codex/v1-release-20260805`

Pull request: [#726](https://github.com/Singularityszn/pubmax/pull/726)

## Release intent

Wave 0 closes public-release risks found in the 5 August product, mobile, trust,
and security review. It does not replace Fable's product work. Changes are
isolated on the V1 release branch and limited to release safety, honest product
claims, and mobile paths blocked by shipped chrome.

## Included

### Trust and product truth

- Night Crawl restores the previous cursor and optimistic state when a save is
  rejected or the network fails. Success state appears only after confirmation.
- Drink price presentation distinguishes baseline dataset values from dated
  update observations. Freshness budgets and London-local dates come from shared
  helpers.
- Demo-off mode removes demo prices and overlays through one shared classifier.
- Profile reaction summaries use bounded batches, abort cleanly, and fail soft.

### Mobile release path

- Venue tabs keep Last train reachable at 320, 390, and 430 pixel widths.
- Today removes duplicate safe-area and bottom-space ownership.
- Android install UI is a compact, non-modal card. It stays below 30 percent of
  a 320 pixel viewport with large text while leaving the map interactive.
- The native install event is captured before the lazy prompt mounts, retained
  in a shared store, consumed once, and cleared after installation.
- iOS keeps the instruction sheet because its install flow is manual.

### Security and identity

- Migration `20260806035204_0070_v1_release_security.sql` denies browser DML on
  eight Night Memory and voice tables while retaining the service-role path.
- The same migration moves Wave 2 SECURITY DEFINER policy helpers into the
  unexposed `pubmax_private` schema. Existing policy dependencies and function
  OIDs are preserved. Public PostgREST RPC discovery no longer exposes them.
- Voice token quota is reserved before provider allocation. Provider failure
  triggers one compensation attempt. A failed compensation emits
  `pub_pal.voice_quota_release_failed` for operator reconciliation.
- Reserved profile handles are rejected consistently for anonymous and signed-in
  routes, including deletion paths.
- Account-link authorization derives read, write, or delete intent from the
  request method, and `DELETE` never claims ownership. This release keeps the
  existing first-authenticated-write `linkUser` path. It does not include the
  Fable/Social Night Loop atomic-ownership commit `ecddfe6f5` or migration
  `0071`; a later merge must explicitly reconcile its `frozen_legacy` and
  `createOwned` semantics with this gate.
- Clerk UI requires both Clerk keys and an established PUBMAXX product session.
  Account controls remain contained in the existing compact navigation popover.
- RLS session fixtures now model PostgREST 14 JSON JWT claims while retaining the
  legacy fallback used by older local environments.

## Verification evidence

After every release correction is committed, run `git rev-parse HEAD` on the
clean release tree and record its full output in the pull request release-gate
comment. Do not embed that value in this tracked file, because committing the
edit would create a different SHA. Push the recorded commit, confirm the pull
request head has the same SHA, and rerun every gate below on that exact tree. A
branch name or pull request number is not verification authority.

- `NEXT_DIST_DIR=.next-prod npm run ci`
  - data validation passed
  - lint passed with 29 pre-existing warnings and zero errors
  - TypeScript passed
  - Vitest coverage gate passed after aligning the legacy drink expectation with
    the new `lane: "dataset"` contract
  - resilient audit passed
  - Next production build completed across 466 static pages
- `npm run test:rls`: 61 tests passed against PostgreSQL 16.14 and
  PostgREST 14.16, including migration, public RPC denial, JSON-claim access,
  service-role access, and exact rollback.
- Mobile V1 Playwright matrix: 14 tests passed across 320, 390, and 430 pixel
  phone viewports plus desktop coverage.
- Independent agent review completed for trust, security, and mobile lanes.
  Final release review remains bound to the verified commit above.

Known build warnings: four existing Edge-runtime warnings in `lib/ogBrand.tsx`
for Node font-file access. Build succeeds. This wave does not change that path.

## Production gate owned by Captain

Do not apply the production migration or promote this branch while the verified
commit is unrecorded, differs from the pull request head, or lacks required
checks.

### 1. Freeze and verify the release candidate

Before building the release preview, set `NEXT_PUBLIC_DEMO_CONTENT=off` in both
the Vercel Preview and Production environments. This public build-time setting
needs a fresh deployment. Confirm the preview contains no seeded Pint Drops,
ambient presence, menu seeds, or demo menu overlays before promotion.

Release operator must then confirm:

1. The exact full commit SHA is recorded in the pull request release-gate
   comment.
2. Pull request head matches that SHA and all required checks pass for it.
3. Preview smoke tests pass for authentication, map, Today, Tonight, profile,
   Night Crawl, voice-token denial, and Android install-card behaviour.
4. Preview source and runtime inspection confirm
   `NEXT_PUBLIC_DEMO_CONTENT=off` was compiled into the deployment.
5. Preview logs contain no unexplained `pub_pal.voice_quota_release_failed`
   event. Any event requires the operator to pause promotion and Captain to
   reconcile the confirmed unreleased reservation for its logged owner and
   month.

### 2. Apply and verify migration 0070

Captain alone applies
`supabase/migrations/20260806035204_0070_v1_release_security.sql` to Supabase
project `iankajxliutqogqkmvdg`. Current production migration history stops at
`0069`. Agents ship and test SQL only.

After Captain applies `0070`, release operator must confirm:

1. `0070` appears once in production migration history.
2. Supabase security advisor no longer reports public exposure of the eight
   `rls_*` helpers.
3. The helpers exist only in `pubmax_private`, authenticated browser DML remains
   denied on the protected tables, and service-role API paths still work.
4. The affected preview authentication, Night Memory, and voice-token paths pass
   again against the migrated project.

### 3. Merge, promote, and verify production

Merge only after the candidate and migration gates pass. Promote the resulting
production-branch commit, wait for Vercel to report Ready, and confirm the
deployment source matches that merge result. Then run production smoke checks
for authentication, map, Today, Tonight, profile, Night Crawl, voice-token
denial, Android install-card behaviour, and absence of demo content. Review
deployment logs for new errors and `pub_pal.voice_quota_release_failed`; any
unreconciled quota event blocks release completion.

## Follow-up, not a V1 promotion blocker

- The 5 August local data gate reports `price_updates`, `weather`, and `whats_on`
  stale. Existing issue [#635](https://github.com/Singularityszn/pubmax/issues/635)
  tracks the overlapping scheduler failure for `price_updates` and
  `night_signals`; weather and what's-on need separate operational follow-up.
  Surfaces disclose degraded freshness rather than presenting stale material as
  current.
- Supabase leaked-password protection becomes mandatory if password sign-in is
  introduced. Current shipped auth uses magic-link OTP and OAuth, not password
  authentication.
- Physical Android native install chooser remains device-only QA. Browser tests
  cover prompt retention, card geometry, focus, persistence, and install event
  cleanup.

## Rollback

Database rollback is Captain-only. Do not execute
`supabase/migrations/rollback/20260806035204_v1_release_security_rollback.sql`
directly against production or pair it with an ad hoc migration-history repair.
Direct SQL alone leaves the ledger claiming a schema state that no longer
exists. Marking `0070` reverted erases applied history and allows a later push to
reapply it unexpectedly.

Preferred emergency path:

1. Stop promotion and identify the last known-good app deployment.
2. Create and review a new timestamped forward migration under
   `supabase/migrations/` whose body is the tested inverse in the rollback file.
   Keep `0070` in migration history so the ledger records both changes.
3. Run the effective RLS rollback proof against that exact compensating
   migration.
4. Redeploy the compatible last known-good app and wait for Vercel Ready.
5. Captain applies the compensating migration through the normal tracked
   migration path.
6. Confirm the new migration appears after `0070`, then verify the function
   schema, policy catalogue, privilege catalogue, application smoke paths, and
   advisor output.

The tested inverse restores the exact post-`0069`, pre-`0070` catalogue without
`CASCADE`. It also deliberately restores authenticated browser DML and moves the
eight SECURITY DEFINER helpers back into the exposed `public` schema. Treat that
state as a temporary security regression, restrict public traffic, and ship a
reviewed replacement before reopening normal traffic.
