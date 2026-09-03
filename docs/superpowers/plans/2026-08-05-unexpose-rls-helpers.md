# Unexpose RLS Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep eight policy helper functions executable by PostgreSQL policies while removing them from PostgREST's exposed `public` schema and making local HTTP identity proof match production JWT semantics.

**Architecture:** Migration `0070` moves existing helper OIDs into a dedicated `pubmax_private` schema, then repairs the three SQL wrappers whose bodies contain schema-qualified helper calls. Effective tests use a throwaway PostgreSQL 16 and PostgREST 14 instance to prove schema, ACL, HTTP, policy, and rollback behavior.

**Tech Stack:** PostgreSQL 16 SQL migrations, PostgREST 14, Node.js harness, TypeScript, Vitest.

## Global Constraints

- Start from commit `1e5bfa9c889bb13a5b01fec90bfb0cc2be43ab28`.
- Use red-green TDD and capture both failures before editing migration or fixture implementation.
- Extend only unapplied migration `0070`; never edit applied migrations `0065` through `0069`.
- Preserve helper OIDs, signatures, `SECURITY DEFINER`, `STABLE`, fixed `search_path = public`, and policy behavior.
- Keep `pubmax_private` outside `PGRST_DB_SCHEMAS`; do not expose a second API schema.
- Grant schema usage and helper execution only to `authenticated` and `service_role`.
- Rollback must restore exact pre-0070 policy, function, privilege, and schema catalogs and drop `pubmax_private` without `CASCADE`.
- Do not apply any production migration. Captain owns production migration execution.
- Do not change price, trust, or mobile product code.
- Never use an em dash.

---

### Task 1: Add Red Effective Proof

**Files:**
- Modify: `__tests__/rlsWave2Session.test.ts`
- Modify: `scripts/rls/session-harness.mjs`

**Interfaces:**
- Consumes: `startRlsSession()`, PostgreSQL role sessions, JWT-backed `rest()` requests, pre-0070 helper OIDs.
- Produces: `preV1HelperOids: Record<string, string>` and `reloadPostgrestSchema(): Promise<void>` on the effective test session.

- [ ] **Step 1: Define the exact helper inventory and capture pre-0070 OIDs**

```ts
const RLS_HELPERS = [
  { name: "rls_current_profile_id", arguments: "", rpcQuery: "" },
  { name: "rls_owns_profile", arguments: "uuid", rpcQuery: `?p_profile_id=a1111111-1111-1111-1111-111111111111` },
  { name: "rls_owns_handle", arguments: "text", rpcQuery: "?p_handle=alice" },
  { name: "rls_is_plan_participant", arguments: "uuid", rpcQuery: "?p_plan_id=a1000000-0000-4000-8000-000000000001" },
  { name: "rls_is_conversation_participant", arguments: "uuid", rpcQuery: "?p_conversation_id=b1000000-0000-4000-8000-000000000001" },
  { name: "rls_current_price_actor", arguments: "", rpcQuery: "" },
  { name: "rls_follows_handle", arguments: "text", rpcQuery: "?p_handle=alice" },
  { name: "rls_can_read_visit_report", arguments: "text, text, text", rpcQuery: "?p_status=visible&p_visibility=friends&p_handle=alice" },
] as const;
```

Capture `proname -> oid` after migrations `0065` through `0069` and expose it from `startRlsSession()`. Include `pubmax_private` schemas, schema ACLs, routine ACLs, and function definitions in `catalogSnapshot()` so rollback comparison observes the dedicated schema.

- [ ] **Step 2: Add failing database and RPC assertions**

For every helper, assert one row exists in `pubmax_private`, zero rows exist in `public`, post-0070 OID equals `preV1HelperOids[name]`, `prosecdef` is true, `provolatile` is `s`, and `proconfig` is `{search_path=public}`. Assert `authenticated` and `service_role` have schema usage and execution, while `PUBLIC` and `anon` do not. Reload PostgREST schema, then request every `/rest/v1/rpc/rls_*` path with an authenticated JWT and expect HTTP 404 with `PGRST202`.

- [ ] **Step 3: Add failing JSON-claims HTTP allow paths**

Seed a linked `plan_crew_members` row for `FRIEND`. Through PostgREST, assert owner `saved_pubs`, follower friends-only `visit_reports`, owner and crew `plans`, and conversation participant `messages` return their rows. Assert non-owner, stranger, and hidden-row queries return empty arrays. Directly execute the three repaired wrappers as authenticated roles and require their expected values.

- [ ] **Step 4: Run red proof twice**

Run:

```bash
npm run test:rls
```

Expected: deterministic failures showing helpers still live under `public`, `/rpc/rls_*` remains reachable, and PostgREST JSON claims do not produce owner, follower, plan-member, or conversation-member identity.

### Task 2: Move Helpers and Repair JWT Fixture

**Files:**
- Modify: `supabase/migrations/20260806035204_0070_v1_release_security.sql`
- Modify: `supabase/migrations/rollback/20260806035204_v1_release_security_rollback.sql`
- Modify: `scripts/rls/session-fixture.sql`

**Interfaces:**
- Consumes: eight `public.rls_*` OIDs and policy dependencies created by migration `0065`.
- Produces: the same OIDs in `pubmax_private`, callable by policy roles but absent from PostgREST's exposed schema.

- [ ] **Step 1: Extend forward migration with dedicated schema and OID-preserving moves**

Create `pubmax_private`, revoke all schema access from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant only `USAGE` to `authenticated` and `service_role`. Move each exact signature with `ALTER FUNCTION public.<signature> SET SCHEMA pubmax_private`.

- [ ] **Step 2: Repair three moved wrapper bodies**

Use `CREATE OR REPLACE FUNCTION pubmax_private.<signature>` to preserve the existing OID and properties. Change only nested calls:

```sql
pubmax_private.rls_is_conversation_participant(uuid)
  -> pubmax_private.rls_owns_handle(text)
pubmax_private.rls_current_price_actor()
  -> pubmax_private.rls_current_profile_id()
pubmax_private.rls_can_read_visit_report(text, text, text)
  -> pubmax_private.rls_owns_handle(text)
  -> pubmax_private.rls_follows_handle(text)
```

Revoke helper execution from `PUBLIC` and `anon`; grant execution to `authenticated` and `service_role`.

- [ ] **Step 3: Restore exact pre-0070 state in rollback**

Move every helper back with `ALTER FUNCTION pubmax_private.<signature> SET SCHEMA public`. Recreate the three wrappers with their original `public.rls_*` nested calls, reassert pre-0070 execution grants, then `DROP SCHEMA pubmax_private` without `CASCADE`.

- [ ] **Step 4: Match production JWT claim semantics in fixture**

```sql
select nullif(
  coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    current_setting('request.jwt.claim.sub', true)
  ),
  ''
)::uuid;
```

JSON `request.jwt.claims` takes precedence for PostgREST. Legacy `request.jwt.claim.sub` remains the fallback for direct SQL-session tests.

- [ ] **Step 5: Run green effective proof**

Run `npm run test:rls`. Expected: PostgreSQL 16 and PostgREST 14 execute every effective test with no dependency skip, all helper privacy and policy paths pass, and both rollback snapshots compare byte-for-byte.

### Task 3: Pin Migration Shape and Close Out

**Files:**
- Modify: `__tests__/v1ReleaseSecurityMigration.test.ts`
- Modify: release report `.superpowers/sdd/2026-08-05-v1-public-release/task-1-report.md` in release worktree

**Interfaces:**
- Consumes: final forward and rollback SQL plus effective proof output.
- Produces: focused static guard against helper recreation or schema exposure, exact verification record, and one security-branch commit.

- [ ] Add focused migration tests requiring all eight `ALTER FUNCTION ... SET SCHEMA` moves, private-qualified wrapper dependencies, exact role grants, reverse moves, and non-`CASCADE` schema removal.
- [ ] Temporarily revert production SQL and fixture changes, run focused tests to confirm the new assertions fail, then restore changes and run focused tests green.
- [ ] Run `npm run test:rls`, `npm run typecheck`, focused ESLint, focused migration tests, `git diff --check`, and a debug-marker scan.
- [ ] Review final diff against every fix-round-four requirement. Remove generated-file churn and unrelated edits.
- [ ] Update Task 1 report with exact red and green outputs, effective dependency versions, changed behavior, rollback evidence, commit SHA, and captain-owned production migration concern.
- [ ] Commit security branch changes with a message stating root cause: helpers remained in PostgREST's exposed schema and fixture ignored JSON JWT claims.
