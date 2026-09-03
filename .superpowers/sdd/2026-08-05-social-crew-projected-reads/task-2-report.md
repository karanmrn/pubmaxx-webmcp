# Task 2 report: atomic Social Crew read snapshots

## Status

DONE

## Implemented

- Added service-only `read_social_crew_snapshot` and
  `read_social_crew_member_page` RPCs.
- Defined each RPC as one `LANGUAGE sql STABLE SECURITY DEFINER` statement with
  an empty `search_path` and schema-qualified objects.
- Bound every read to one active product account and its current profile.
- Added a discriminated detail result. Member reads carry explicit Crew, Plan,
  Stop, context, action, ending, and active-member allowlists. Friends previews
  carry only title, status, Night Area, start time, and Join Request state.
- Kept active or retained former members fail-closed when current membership
  authority is absent. They never fall through to a preview.
- Derived current owner `self` and non-owner Mutual authority through the one
  relationship policy owner, including either-direction blocks.
- Ordered members, Stops, actions, and Join Request history deterministically.
- Returned fixed six-digit UTC membership positions for exact PostgreSQL
  keyset paging.
- Filtered account binding, active membership, owner binding, current Mutual
  authority, and blocks before the keyset cursor and `LIMIT + 1`.
- Added order-supporting membership and Join Request history indexes after
  baseline `EXPLAIN` evidence showed both reads required a Sort.
- Added exact service-role ACL and rollback catalog coverage.

## TDD evidence

### RED

Command:

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1
```

Observed before migration edits:

```text
Test Files  1 failed (1)
Tests  7 failed | 29 passed (36)
```

Expected failures showed both RPCs and their ACLs were absent. The seven RED
groups covered exact member output, exact preview omission, denial states,
latest Join Request projection, five two-session authority races, and
authority-first member paging.

### Query-plan evidence

Baseline membership plan:

```text
Index Scan using social_crew_members_account_idx
Sort Key: member.joined_at DESC, member.id DESC
```

Baseline Join Request plan:

```text
Seq Scan on social_crew_join_requests
Sort Key: created_at DESC, id DESC
```

The GREEN suite forces index eligibility and confirms the shipped predicates
and order use `social_crew_members_active_page_idx` and
`social_crew_join_requests_history_idx`.

### GREEN

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1
Test Files  1 passed (1)
Tests  36 passed (36)

npm run test:rls
Test Files  1 passed (1)
Tests  36 passed (36)

npx vitest run __tests__/socialCrewProjection.test.ts __tests__/socialCrewStore.test.ts __tests__/socialCrewRoutes.test.ts __tests__/socialRelationships.test.ts __tests__/socialCrewLegacyPlanBoundary.test.ts __tests__/socialCrewLegacyPlanCollaborationBoundary.test.ts --maxWorkers=1
Test Files  6 passed (6)
Tests  164 passed (164)

npm run typecheck
exit 0

npm run lint
exit 0, 0 errors, 33 existing warnings

git diff --check
exit 0
```

## Files changed

- `supabase/migrations/20260805140000_0075_social_crews.sql`
- `supabase/migrations/rollback/20260805140000_0075_social_crews_rollback.sql`
- `__tests__/socialCrewMigration.test.ts`

## Self-review

- No row serialization or raw durable-row JSON spread exists.
- Preview result contains no Crew or Plan ID, revision, protected array,
  member identity, or count.
- Member-page RPC does not invoke detail RPC and returns no Plan or member
  arrays.
- Current relationship policy remains in one existing helper.
- Rollback restores the exact pre-0075 catalog.
- No TypeScript production file, hosted migration, push, or deployment changed.

## Independent verification

Verifier inspected authority, output omission, snapshot, pagination, index,
ACL, rollback, and race contracts. It found Fix Round 1, then inspected the
correction and reran PostgreSQL, RLS, authority, typecheck, lint, and diff
gates:

```text
VERDICT: PASS
```

## Concerns

None.

## Fix round 1: invalid Plan-member binding cannot downgrade

### Finding

Independent verification found that an existing Social membership with a
mismatched Plan-member binding was absent from the valid member CTE. A current
Mutual actor could then fall through to a friends preview. Membership evidence
must suppress preview even when its Plan binding is invalid.

### RED

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1
Test Files  1 failed (1)
Tests  1 failed | 35 passed (36)
```

The failing read returned a preview instead of SQL `NULL` after the active
Social membership was rebound to a Plan member from another Plan.

### GREEN

The detail snapshot now separates any retained membership evidence from valid
active Plan-member authority. A valid active binding can receive member data.
Any other retained membership returns SQL `NULL` before preview evaluation.

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1
Test Files  1 passed (1)
Tests  36 passed (36)
```

## Fix round 2: isolated fixtures and deterministic race proof

### Finding

The new read fixtures were created by the first test. Preview and later tests
therefore depended on test order. Race checks also used timing sleeps and
accepted a matching result kind instead of one complete valid snapshot.

### RED

Running the preview test alone before the fix returned SQL `NULL`:

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1 -t "returns the exact friends preview and omits every protected field"
Test Files  1 failed (1)
Tests  1 failed | 35 skipped (36)
```

### GREEN

Each dependent test now calls an idempotent fixture helper. Each new read and
race test passes alone with `-t`.

Race tests use an interactive writer transaction, an advisory transaction lock,
and an explicit ready marker. The reader runs only after the uncommitted
mutation reaches that barrier. Every block, friendship loss, owner transfer,
membership removal, and suspension race must equal the complete exact pre-write
snapshot. The committed result is then checked against the exact new state.

Final gates:

```text
npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1
Test Files  1 passed (1)
Tests  36 passed (36)

npm run test:rls
Test Files  1 passed (1)
Tests  36 passed (36)

npx vitest run __tests__/socialCrewProjection.test.ts __tests__/socialCrewStore.test.ts __tests__/socialCrewRoutes.test.ts __tests__/socialRelationships.test.ts __tests__/socialCrewLegacyPlanBoundary.test.ts __tests__/socialCrewLegacyPlanCollaborationBoundary.test.ts --maxWorkers=1
Test Files  6 passed (6)
Tests  164 passed (164)

npm run typecheck
exit 0

npm run lint
exit 0, 0 errors, 33 existing warnings
```

Production migration and rollback SQL remain unchanged in this fix round. No
hosted migration, push, or deployment occurred.

### Independent verification

Reviewer ran all six new tests alone, repeated the race test five times, ran
the full migration suite, inspected the barrier and exact snapshot assertions,
and confirmed the production SQL diff is empty.

```text
No findings. Ready to commit.
```
