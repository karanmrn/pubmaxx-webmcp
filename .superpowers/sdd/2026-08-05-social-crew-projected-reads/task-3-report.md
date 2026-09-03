# Task 3 report: signed Social Crew member reads

## Status

DONE

## Implemented

- Replaced default multi-query Crew detail reads with one
  `read_social_crew_snapshot` RPC.
- Removed store-owned Crew, member, profile, relationship, Plan, and Join
  Request read reconstruction.
- Extended `projectSocialCrewRead` to parse discriminated atomic member and
  preview snapshots. Preview parsing needs no protected member or Plan data.
- Added `lib/socialCrewCursor.server.ts` as sole member cursor owner.
- Added viewer-profile-bound SHA-256 HMAC cursors with exact version, lane,
  six-digit UTC membership timestamp, and scoped member ID payload.
- Added canonical base64url, exact JSON payload, UUID, timestamp, size, and
  timing-safe signature validation.
- Added strict list input and exact error precedence: actor, query/envelope,
  signing key, HMAC/semantics, RPC, stale binding, malformed snapshot.
- Added `list(actor, input)` using one `read_social_crew_member_page` RPC and
  the sole list projector. It performs no detail reads, post-filter, refill,
  or memory fallback.
- Replaced mocked pagination claims with PostgreSQL 16 tests against the real
  `read_social_crew_member_page` function.
- Added isolated two-page fixtures that delete the cursor row, insert a newer
  row, block, unfriend, and remove active membership between reads.
- Added default `createSocialCrewStore().list()` proof. It mocks only Supabase
  and trusted signing-key seams, then checks exact production RPC input,
  microsecond cursor fields, limit-plus-one response shape, and HMAC output.

## TDD evidence

### RED

Command:

```text
npx vitest run __tests__/socialCrewReadStore.test.ts
```

Observed before production edits:

```text
Test Files  1 failed (1)
Tests  34 failed (34)
```

The default detail read returned `503` through the stale multi-query loader.
Every list case failed because `store.list` did not exist.

Verifier Fix Round 1 added a semantic snapshot RED:

```text
npx vitest run __tests__/socialCrewReadStore.test.ts -t "maps null authority to not found"
Test Files  1 failed (1)
Tests  1 failed | 33 skipped (34)
```

A malformed `kind: "member"` snapshot without the viewer resolved to a
preview. The projector now requires the projected discriminant to remain
`member` and returns dependency unavailable otherwise.

Review Fix Round 1 used behavior mutations because production behavior was
already present. Each new PostgreSQL regression failed against its broken
behavior before final GREEN:

```text
cursor comparison changed from < to >
continues from the exact member position ... failed

relationship authority changed from mutual to any non-null state
filters current authority ... after 'a block' ... failed
filters current authority ... after 'an unfriend' ... failed

viewer membership filter admitted removed rows
filters current authority ... after 'active membership removal' ... failed

Test Files  1 failed (1)
Tests  1 failed | 39 skipped (40)
```

Each failure returned the revoked or out-of-window Crew instead of the expected
older authorised Crew. Every mutation was restored before GREEN. An earlier
fixture cleanup failure also corrected test isolation: cleanup now deletes Crew
rows before referenced Plan members. No production defect appeared, so no
production file remains changed in this round.

### GREEN

Required regression command:

```text
npx vitest run __tests__/socialCrewProjection.test.ts __tests__/socialCrewReadStore.test.ts __tests__/socialCrewStore.test.ts __tests__/socialCrewMigration.test.ts __tests__/socialRelationships.test.ts __tests__/socialCrewLegacyPlanBoundary.test.ts __tests__/socialCrewLegacyPlanCollaborationBoundary.test.ts --maxWorkers=1
```

Observed after the verifier fix:

```text
Test Files  7 passed (7)
Tests  164 passed (164)
```

PostgreSQL and store-focused checks:

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1
Tests  40 passed (40)

npx vitest run __tests__/socialCrewReadStore.test.ts
Tests  31 passed (31)
```

Each new database case also passed alone with `-t`: cursor-row deletion plus
newer insertion, block, unfriend, and active membership removal.

Additional final checks:

```text
npx tsc --noEmit --pretty false
exit 0

npx eslint __tests__/socialCrewMigration.test.ts __tests__/socialCrewReadStore.test.ts
exit 0, pristine

npm run lint
exit 0, 0 errors, 33 existing warnings outside Task 3 files

git diff --check
exit 0
```

## Mutation evidence

Each mutation was applied alone, failed its owning test, and was restored:

1. Removed viewer profile ID from the HMAC domain. Cross-actor cursor test
   failed.
2. Skipped trusted-key resolution on a first empty page. Per-call key test
   failed.
3. Truncated membership microseconds to milliseconds. Precision test failed
   with `.123000Z` instead of `.123456Z`.
4. Reversed the member-page keyset comparison. The deletion/insertion test
   returned the newer insert and first-page row instead of older rows.
5. Admitted every relationship state. Block and unfriend tests returned the
   revoked Crew instead of filling the page with the older authorised Crew.
6. Admitted removed viewer memberships. Membership-removal test returned the
   removed Crew instead of filling the page with the older authorised Crew.

Final GREEN ran after all mutations were restored.

## Independent verification

Verifier first found the member-to-preview discriminant downgrade. After the
RED and fix, it reran focused tests, typecheck, focused lint, and diff checks:

```text
No findings.
SPEC COMPLIANT: YES
QUALITY APPROVED: YES
VERDICT: PASS
```

## Files changed

- `lib/socialCrewCursor.server.ts`
- `lib/socialCrewStore.ts`
- `lib/socialCrewProjection.server.ts`
- `__tests__/socialCrewReadStore.test.ts`
- `__tests__/socialCrewStore.test.ts`
- `__tests__/socialCrewMigration.test.ts`

## Self-review

- Cursor policy has one server-only owner.
- Store has one injected snapshot dependency for both read RPCs and no durable
  read fallback.
- Atomic preview projection never reads protected data.
- List projection remains the sole raw-list to browser boundary.
- No SQL, route, hosted database, beta flag, push, deployment, or unrelated
  product file changed.

## Environment note

Removed three ignored, rebuildable Next.js RED build caches after filesystem
free space reached 101 MB and blocked patch writes:

- `.next-task5-red`
- `.next-task5-red2`
- `.next-task5-red2-keyless`

Review Fix Round 1 removed finished Task 5 and Task 6 Next build caches after
PostgreSQL initialization twice failed with no free disk space. It also stopped
and removed one orphaned temporary PostgreSQL cluster after its Vitest parent
ended. These generated artifacts are rebuildable and are not repository files.

## Concerns

None.
