# Social Crew Authority Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind one existing Planned Night to verified Social Crew ownership and add stable friendship, membership, invitations, Join Requests, roles, transfer, removal, and leave.

**Architecture:** Service-role-only migration 0075 stores authority by private PUBMAXX account ID and resolves friendship by stable profile ID. API routes receive actor authority only from `requireVerifiedSocialActor()`. Atomic RPCs own races and idempotency. No protected memory fallback exists.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase PostgreSQL, Vitest, Playwright.

## Global Constraints

- Migration 0075 follows 0074 and is not applied to a hosted database by agents.
- Crew membership never creates or preserves friendship.
- Handle is display only. Account ID owns Crew state. Profile ID owns follows and blocks.
- Planned Night owns title, start time, nullable Night Area, status, phase
  derivation, route revision, Stops, and Plan state. Crew owns visibility and
  `authorityRevision` only.
- Private denial and protected-object denial return indistinguishable `404`.
- Dependency failure returns `503`, never empty data or `404`.
- Every protected response is private and no-store.
- Do not edit Task 6 post, composer, media, tag, or moderation files.
- TDD RED must be observed before production code.

---

### Task 1: Stable relationship seam

**Files:**
- Create: `lib/socialRelationships.server.ts`
- Test: `__tests__/socialRelationships.test.ts`

**Interfaces:**
- Consumes: stable profile IDs and existing `follows`, `social_blocks`, and `social_interaction_blocked` data.
- Produces: `socialRelationshipBetweenProfiles(firstProfileId, secondProfileId)` with `self | mutual | not_mutual | blocked | unavailable`.

- [ ] **Step 1: Write relationship RED tests**

  Use literal profile IDs. Prove reciprocal follows produce `mutual`, one-way
  follows produce `not_mutual`, either-direction block produces `blocked`, self
  produces `self`, and store failure produces `unavailable`. The production
  mutation each test catches is a wrong follow direction, missing block branch,
  handle lookup, or fail-open dependency path.

- [ ] **Step 2: Run RED**

  Run `npx vitest run __tests__/socialRelationships.test.ts`.
  Expected: import or function failure because seam does not exist.

- [ ] **Step 3: Implement minimal server seam**

  Add closed result types and one injected query adapter for tests. Default
  adapter calls `social_relationship_between_profiles` through Supabase admin.
  Do not import `followStore` or accept handles.

- [ ] **Step 4: Run GREEN and refactor**

  Run the focused test and `npx eslint lib/socialRelationships.server.ts __tests__/socialRelationships.test.ts`.

- [ ] **Step 5: Commit**

  Commit only relationship module and test with message
  `feat: add stable Social relationship authority`.

### Task 2: Migration 0075 foundation and rollback

**Files:**
- Create: `supabase/migrations/20260806235944_0075_social_crews.sql`
- Create: `supabase/migrations/rollback/20260806235944_0075_social_crews_rollback.sql`
- Create: `__tests__/socialCrewMigration.test.ts`
- Modify: `lib/planStore.ts`
- Create: `__tests__/socialCrewLegacyPlanBoundary.test.ts`

**Interfaces:**
- Consumes: migration 0071 private accounts, 0073 blocks, 0074 Social access, existing Plans and Plan members.
- Produces: relationship RPC, core Crew tables, Plan bindings, atomic foundation RPCs, exact rollback.

- [ ] **Step 1: Write catalog and race RED tests**

  Apply all prerequisite migrations to throwaway PostgreSQL 16. Capture the
  pre-0075 catalog. Require foundation tables, columns, grants, RPC revocation,
  double-accept linearisation, owner transfer races, idempotency replay/conflict,
  legacy invite revocation, token rotation, and byte-equivalent catalog after
  rollback. Also require anonymous and old-capability legacy Plan reads and
  every legacy Plan write family to return not found after conversion.
  The TypeScript boundary test must prove central legacy `planStore.get` and
  `planStateResult` exclude a bound Plan while the server-only Social read can
  still assemble it after authority succeeds.

- [ ] **Step 2: Run RED**

  Run `npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1`.
  Expected: missing migration or missing relation.

- [ ] **Step 3: Add core schema**

  Create `social_crews`, `social_crew_members`, `social_crew_invitations`,
  `social_crew_join_requests`, and `private_social_crew_write_receipts`. Add
  `plans.social_owner_account_id` and
  `plan_crew_members.social_account_id`. Use account IDs internally. Member
  rows expose only their scoped member ID later. Store one immutable
  `plan_member_id` per Crew member, retain it on leave/removal, and reuse it on
  reactivation. Enforce one Plan-member Social binding per Plan and account.
  Add closed membership, invitation, and Join Request states, 20 active member
  capacity, one pending targeted row per account, and expiry at the earlier of
  seven days or `planScheduledEndMs(startTime)`. Membership states are exactly
  `active | left | removed`; invalid or ended Plans cannot mint invitations or
  Join Requests.

- [ ] **Step 4: Add atomic RPCs**

  Implement relationship, create, invite, accept, Join Request, role, transfer,
  remove, leave, and visibility RPCs. Replace or fence central legacy Plan
  lookup and every legacy Plan mutation RPC so a Crew-bound Plan is not found.
  Each write locks authority rows, rechecks friendship
  and blocks, uses actor/operation/key receipt with payload digest, and returns
  stable replay or changed-payload conflict.

- [ ] **Step 5: Add security and rollback**

  Enable RLS, revoke browser roles, grant service role, revoke RPC execution
  from public roles, and use empty search path. Rollback must restore exact
  tables, columns, functions, policies, grants, indexes, and constraints.

- [ ] **Step 6: Fence legacy TypeScript Plan reads**

  Make central legacy `planStore.get` and `planStateResult` exclude rows whose
  `social_owner_account_id` is set. Add one server-only bound-Plan read for the
  Social Crew store; it must require the expected owner account ID and must not
  use a memory fallback. Prove anonymous and old-capability reads remain `404`
  while that authorised internal read still returns Plan state.

- [ ] **Step 7: Run GREEN**

  Run migration and legacy-boundary tests until every forward, race, read
  firewall, and rollback assertion passes.

- [ ] **Step 8: Commit**

  Commit migration, rollback, Plan boundary, and tests with message
  `feat: add Social Crew authority schema`.

### Task 3: Domain and durable store

**Files:**
- Create: `lib/socialCrew.ts`
- Create: `lib/socialCrewStore.ts`
- Create: `lib/socialCrewProjection.server.ts`
- Test: `__tests__/socialCrewStore.test.ts`

**Interfaces:**
- Consumes: `SocialPostActor`, relationship seam, foundation RPCs.
- Produces: closed Crew types and `SocialCrewStore` foundation operations.

- [ ] **Step 1: Write store RED tests**

  Prove no memory write fallback, actor account ownership, scoped member IDs,
  same-key replay, same-key changed-payload conflict, different-key independence,
  `404` denial, `503` dependency failure, self-leave after unfriend,
  protected-state removal after block, immutable Plan-member provenance,
  reactivation, and owner-only visibility revision.

- [ ] **Step 2: Run RED**

  Run `npx vitest run __tests__/socialCrewStore.test.ts`.

- [ ] **Step 3: Implement closed vocabulary and store**

  Add exact types from the spec. Derive title, start time, nullable Night Area,
  phase, route revision, and Plan state from the Planned Night. Use only
  Supabase admin RPCs for protected writes. Parse raw rows through the
  projection module before returning them.

- [ ] **Step 4: Run GREEN and mutation check**

  Mutate one role branch, block result, idempotency digest, and account field in
  thought or locally. Confirm a named test would fail for each.

- [ ] **Step 5: Commit**

  Commit domain, projection, store, and tests with message
  `feat: add Social Crew foundation store`.

### Task 4: Verified Crew routes

**Files:**
- Create: `lib/socialCrewHttp.ts`
- Create: `app/api/social/crews/route.ts`
- Create: `app/api/social/crews/[crewId]/route.ts`
- Create: `app/api/social/crews/[crewId]/invitations/route.ts`
- Create: `app/api/social/crews/[crewId]/invitations/[invitationId]/route.ts`
- Create: `app/api/social/crews/[crewId]/join-requests/route.ts`
- Create: `app/api/social/crews/[crewId]/join-requests/[requestId]/route.ts`
- Create: `app/api/social/crews/[crewId]/members/[memberId]/route.ts`
- Create: `app/api/social/crews/[crewId]/leave/route.ts`
- Test: `__tests__/socialCrewRoutes.test.ts`

**Interfaces:**
- Consumes: verified Social actor, Crew store, bounded requests.
- Produces: private no-store JSON routes and stable HTTP error mapping.

- [ ] **Step 1: Write route RED tests**

  Prove signed-out, unverified, unavailable, forged authority fields, malformed
  body, missing idempotency key, not found, conflict, and success branches.
  Complete request mocks must mirror real actor and DTO shapes.

- [ ] **Step 2: Run RED**

  Run `npx vitest run __tests__/socialCrewRoutes.test.ts`.

- [ ] **Step 3: Implement minimal routes**

  Call `requireVerifiedSocialActor()` first. Reject unknown keys. Accept target
  profile or scoped member ID only where contract names it. Derive actor,
  account, role authority, and digest on server. Crew creation reads its
  one-time legacy host capability from the `Authorization` header. No later
  Crew route accepts it. Return private no-store JSON.

- [ ] **Step 4: Run GREEN**

  Run route, store, relationship, and migration tests together. Run typecheck,
  focused lint, and diff check.

- [ ] **Step 5: Commit**

  Commit HTTP module, routes, and tests with message
  `feat: add verified Social Crew membership routes`.

### Task 5: Slice review and handoff

**Files:**
- Modify: `specs/social-crews/README.md`
- Create: `.superpowers/sdd/2026-08-05-verified-social-night-loop/task-7-slice-1-report.md`

- [ ] **Step 1: Run focused gate**

  Run relationship, store, route, and PostgreSQL suites, then typecheck, lint,
  and diff check.

- [ ] **Step 2: Run independent review**

  Require SPEC COMPLIANT and QUALITY APPROVED for stable ownership, no-follow
  writes, friendship/block revocation, owner races, idempotency, legacy token
  shutdown, no memory fallback, and rollback.

- [ ] **Step 3: Update handoff**

  Record commits, exact counts, remaining release conditions, and Slice 2 as the
  next pickup. Do not mark Slice 1 complete before review approval.

- [ ] **Step 4: Commit documentation**

  Commit plan state and report with message
  `docs: close Social Crew authority foundation`.
