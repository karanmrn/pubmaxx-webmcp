# Task 5 report: Social Crew authority handoff

## Status

Fix Round 2 complete. Independent verifier returned `VERDICT: PASS`.

Review base: `8d6fccbf4 fix: close Social Crew authority review`.

## Fix Round 1

### Stable denial replay

Stored write failures now replay their original deterministic response for the
same actor, operation, key, and digest. Successful receipts retain the existing
`replayed` success code. A changed digest still returns
`idempotency_conflict`.

RED: same-digest replay returned `{ ok: false, code: "replayed" }` instead of
the stored `not_found` denial.

GREEN: the PostgreSQL 16 migration test proves original denial replay, changed
digest conflict, and unchanged successful replay semantics.

### Atomic legacy Plan metadata

Legacy Plan status and context changes now use one service-only RPC. It locks
the Plan first, hides Crew-bound Plans, verifies the legacy host token, checks
the transition against locked status, and writes status and context in the same
transaction. TypeScript no longer uses a pre-read plus direct Plan update.

RED: PostgreSQL reported the new function was absent. The TypeScript boundary
test then showed no RPC call. A direct NULL-token case later returned `ok` due
to SQL three-valued comparison.

GREEN: host, guest, NULL-token, invalid-transition, and Crew-bound cases pass.
Both race schedules pass without deadlock: conversion-first makes the metadata
write return `not_found`; metadata-first commits metadata before conversion.
Rollback restores the exact pre-0075 function and grant catalog.

### Membership authority revision

First activation and reactivation now increment `authority_revision` once when
membership changes to active. Existing active membership and idempotent replay
do not increment it. Invitation and Join Request acceptance retain their Crew
lock before membership work.

RED: double invitation acceptance created one member but left revision at 1
instead of 2. Reactivation later left revision at 3 instead of 4.

GREEN: invitation and Join Request double-acceptance races each activate one
member and increment once. A reactivation race accepts both an invitation and a
Join Request into one retained Plan member, increments once, and exact replay
leaves revision unchanged.

## Fix Round 2

### Parent Crew scope

Invitation accept or decline, invitation revoke, and Join Request decision now
retain the parent Crew ID from the route path through the store and PostgreSQL
RPC. Store inputs require `crewId`, RPC payloads use `p_crew_id`, and payload
digests include that value.

Each RPC locks the named Crew before its child row. Child selection uses both
the child ID and Crew ID. A mismatched parent returns the same `not_found`
result as an absent protected child. Existing correct-parent accept, decline,
revoke, and decision behaviour remains unchanged.

Nested write receipts now scope their operation key to the parent Crew. A
same-key request for the same child through another Crew path cannot replay the
first path's result. It receives `not_found`, while same-parent replay and
changed-payload conflict remain unchanged.

Service-role grants, browser-role revocations, function signatures, and exact
rollback drops now use the parent-scoped RPC signatures.

### TDD evidence

Route and store RED:

```text
npx vitest run __tests__/socialCrewRoutes.test.ts __tests__/socialCrewStore.test.ts --maxWorkers=1
```

Result: 2 files failed, 9 tests failed, and 93 passed. Failures showed every
nested route omitting `crewId`, each RPC payload omitting `p_crew_id`, and
same-child digests remaining equal across different parent paths.

PostgreSQL signature RED:

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1
```

Result: 17 tests failed and 13 passed. PostgreSQL reported the new six-argument
invitation and Join Request functions were absent. Later expected cascade
failures came from state-changing tests that could not call those functions.

Cross-parent idempotency RED after signature implementation:

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1
```

Result: 1 test failed and 29 passed. Same child and key through another Crew
path returned `idempotency_conflict`; required result was `not_found` without
replaying prior success.

ACL mutation RED: removing the revoke RPC from browser-role revocation made the
targeted service-only test fail with authenticated execute privilege `t`
instead of `f`. Restoring the revocation returned the suite to green.

Route and store GREEN: 2 files and 102 tests passed.

PostgreSQL GREEN: 1 file and 30 tests passed, including mismatched-parent
denial, correct-parent success, parent-scoped replay, service-only grants, and
exact rollback catalog restoration.

### Fix Round 2 verification

```text
npx vitest run __tests__/socialCrewRoutes.test.ts __tests__/socialCrewStore.test.ts __tests__/socialRelationships.test.ts __tests__/socialCrewLegacyPlanBoundary.test.ts __tests__/socialCrewMigration.test.ts __tests__/writeSurfaceCertification.test.ts --maxWorkers=1
```

Result: 6 files and 162 tests passed.

```text
npm run test:rls
```

Result: 1 file and 36 tests passed, including exact rollback catalog proof.

```text
npm run typecheck
npm run lint
```

Result: TypeScript passed. ESLint exited 0 with 33 existing warnings outside
owned files. Focused lint for all owned TypeScript files passed cleanly.

`git diff --check` passed.

Independent verifier confirmed parent scope, Crew-first lock order, child
selection by child ID and Crew ID, per-Crew replay isolation, service-only
ACLs, and exact rollback. No findings.

No hosted migration, push, or deployment performed.

## Deferred

- Existing structural `server-only` boundary and header-order proof gaps remain
  deferred as recorded in the Slice 1 ledger.
