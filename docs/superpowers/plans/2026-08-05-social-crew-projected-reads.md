# Social Crew Projected Reads Implementation Plan

> **For agentic workers:** Use subagent-driven development. Complete one task,
> review it, and fix findings before starting the next task.

**Goal:** Add race-safe Crew Page and member-list reads with explicit detail and
collection DTO boundaries, signed viewer-bound pagination, and no legacy Plan
access.

**Architecture:** Service-role-only PostgreSQL RPCs produce internal read
snapshots at one database statement snapshot. TypeScript parses every raw field.
Detail uses `SocialCrewReadDTO`; collection uses a narrow
`SocialCrewListPageDTO` and never performs per-item detail reads. Friend preview
remains detail-only because its contract contains no Crew identifier. Cursor
position never grants authority; every page rechecks current account,
membership, friendship, and block state.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, Supabase PostgreSQL
16, Vitest.

## Global constraints

- Migration 0075 remains unapplied to hosted databases. Social beta stays off.
- One sequential worker owns migration 0075 and its rollback.
- `projectSocialCrewRead` is the only detail boundary.
  `projectSocialCrewListPage` is the only collection boundary.
- Preview never contains Crew ID, Plan ID, route, exact Venue, identities,
  counts, chat, Check-ins, Safe Home, or protected identifiers.
- An active member who loses owner friendship gets `404`; never downgrade that
  member to preview.
- Unknown, private, blocked, and unauthorised protected reads use the same
  `404`. Dependency or signing-key failure uses `503`.
- Every response uses `Cache-Control: private, no-store` and
  `Vary: Cookie, Authorization`.
- Cursor is HMAC-bound to viewer profile ID, lane, membership timestamp, and
  scoped member row ID. Invalid cursor is `422`.
- No protected read uses a memory fallback or React/server cache.
- TDD RED must be observed before production edits.

---

### Task 1: Fail-closed projection contract

**Files:**

- Modify: `specs/social-crews/README.md`
- Modify: `specs/social-crews/slices/02-projection.md`
- Modify: `lib/socialCrew.ts`
- Modify: `lib/socialCrewProjection.server.ts`
- Create: `__tests__/socialCrewProjection.test.ts`

**Produces:** Explicit parsers, exact detail snapshots, and narrow list DTOs.

- [ ] Add projection RED tests for exact allowed fields, poison extra fields,
  nullable Night Area, phase mapping, distinct route and authority revisions,
  current handles, and omitted legacy `PlanState.crew`.
- [ ] Add malformed-row RED tests for unknown Plan status, invalid UUID, date,
  role, membership state, route revision, Stop, action, ending, and context.
  Each must fail as dependency unavailable, never silently default or omit.
- [ ] Cover every exposed Plan field, including `createdAt`, `anchorVenueId`,
  `anchorSource`, `outcome`, and `routeReadyAt`. Reject duplicate member IDs,
  duplicate identity bindings, duplicate Stop positions, incoherent actions,
  and poison keys at every nesting level. Canonicalise timestamps with
  `toISOString()`.
- [ ] Add exact list-item and list-page snapshots. They may contain only
  `kind`, `crewId`, `title`, `phase`, `nightArea`, `startsAt`, and `viewer`,
  plus the page cursor. They never contain Plan or preview state.
- [ ] `projectSocialCrewListPage(raw, viewer, encodeCursor)` validates raw
  items, `hasMore`, and cursor-position coherence. It calls the injected fake
  encoder in tests, strips internal position fields, and alone returns the final
  `SocialCrewListPageDTO`.
- [ ] Run RED explicitly:
  `npx vitest run __tests__/socialCrewProjection.test.ts`. Record the missing
  parser/list contract or failing assertion before production edits.
- [ ] Add `import "server-only"` to projection owner. Replace object spreading
  with explicit allowlists for Plan, Stops, context, actions, ending, and
  members.
- [ ] Run focused projection and existing store tests. Mutation-check one
  phase branch, one protected field, one role, and one route revision.
- [ ] Commit as `fix: harden Social Crew read projection`.

### Task 2: Atomic detail and member-page snapshots

**Files:**

- Modify: `supabase/migrations/20260806235944_0075_social_crews.sql`
- Modify: `supabase/migrations/rollback/20260806235944_0075_social_crews_rollback.sql`
- Modify: `__tests__/socialCrewMigration.test.ts`

**Produces:** Service-only `read_social_crew_snapshot` and
`read_social_crew_member_page` one-statement RPCs.

- [ ] Write PostgreSQL 16 RED tests for owner full read, current Mutual member
  full read, friends preview, private denial, stranger, either-direction block,
  active-member friendship loss, suspended account, membership removal, owner
  transfer, and dependency absence.
- [ ] Run RED explicitly:
  `npx vitest run __tests__/socialCrewMigration.test.ts --maxWorkers=1`.
  Record missing-function and policy failures before migration edits.
- [ ] Implement each RPC as `LANGUAGE sql STABLE SECURITY DEFINER SET
  search_path = ''` with one top-level CTE/`SELECT`, schema-qualified objects,
  `statement_timestamp()`, and explicit `jsonb_build_object` allowlists. Inputs
  include viewer account and viewer profile; the RPC rechecks their active
  binding. Never use `to_jsonb(row)` or `row_to_json`.
- [ ] Prove detail snapshot reads Crew authority, current relationships,
  membership, latest Join Request, bound Planned Night, Stops, context, actions,
  ending, and active Social members in one `STABLE SECURITY DEFINER` statement
  snapshot. Response is discriminated: member branch carries explicit
  allowlisted Crew, Plan, and member rows; preview branch carries only title,
  status, nullable Night Area, start time, and Join Request state. Preview must
  not carry Crew or Plan IDs, revisions, protected Plan arrays, or member rows.
- [ ] Every SQL JSON aggregate has stable order: Social members by
  `joined_at ASC, id ASC`; Stops by `position ASC`; actions by
  `created_at ASC, id ASC`.
- [ ] Add two-session block, friendship-loss, owner-transfer,
  membership-removal, and account-suspension races. The result must linearise
  to one valid authority state and never mix protected fields across states.
- [ ] Add member-page RED tests ordered by immutable membership
  `(joined_at DESC, id DESC)`, with the cursor predicate applied before
  `LIMIT + 1`. Filter active account/profile binding, active membership, owner
  relationship, and blocks before the limit. Return first `limit` explicit safe
  item rows and the last returned position only when an extra authorised row
  exists. Never return Plan/member arrays or invoke detail RPCs.
- [ ] Prove owner appears through `self`, current Mutual member appears, and
  non-Mutual or blocked members are filtered before cursor and `LIMIT + 1`.
- [ ] Latest Join Request ordering is
  `created_at DESC, id DESC`. Pending is current only while
  `expires_at > statement_timestamp()`; accepted, cancelled, expired, and an
  expired pending row project `none`; declined projects `declined`.
- [ ] Use `EXPLAIN` proof before adding the Join Request history index or active
  membership partial index. Keep only indexes the shipped queries use.
- [ ] Revoke both RPCs from `public`, `anon`, and `authenticated`; grant only
  `service_role`. Update indexes only when query proof requires them.
- [ ] Update exact rollback catalog. Run forward, ACL, race, and rollback tests.
- [ ] Commit as `feat: add atomic Social Crew read snapshots`.

### Task 3: Signed member-list store

**Files:**

- Create: `lib/socialCrewCursor.server.ts`
- Modify: `lib/socialCrewStore.ts`
- Modify: `lib/socialCrewProjection.server.ts`
- Create: `__tests__/socialCrewReadStore.test.ts`
- Modify: `__tests__/socialCrewStore.test.ts`

**Produces:** Atomic default detail read and `list(actor, input)` returning
`SocialCrewListPageDTO` from one list RPC.

- [ ] Replace default multi-query detail loader with the snapshot RPC. Keep one
  injected snapshot dependency for tests; remove stale default read owners.
- [ ] Extend the sole detail projector to parse the discriminated atomic
  snapshot directly. Preview projection must not reconstruct or require
  protected member data.
- [ ] Add cursor RED tests for actor A used by actor B, lane mismatch, signature
  mutation, oversized or malformed token, invalid UUID/date/version, missing
  trusted signing key, and equal timestamp ordering.
- [ ] Run RED explicitly:
  `npx vitest run __tests__/socialCrewReadStore.test.ts`. Record missing cursor,
  list, and default atomic-loader failures before production edits.
- [ ] Sign domain-separated payload
  `{ v: 1, lane: "member", joinedAt, memberId }` with viewer profile ID using
  `trustedSigningKey()`, SHA-256 HMAC, canonical base64url, exact payload keys,
  canonical timestamps, token size bound, and timing-safe comparison. Resolve
  the signing key on every otherwise-valid list request, including first,
  empty, and terminal pages. Missing key is `503`; malformed cursor is `422`.
- [ ] Error precedence is exact: verified actor; strict query and bounded cursor
  envelope (`422`); signing key (`503`); HMAC and semantic payload (`422`);
  list RPC; stale actor/profile binding (`404`); database or malformed snapshot
  (`503`). A structurally valid cursor with a missing key is `503` even when its
  signature is wrong.
- [ ] One list RPC returns safe rows, `hasMore`, and cursor position. Parse it
  through `projectSocialCrewListPage(raw, viewer, encodeCursor)`; never call
  detail per item, post-filter, refill, or advance past a row TypeScript
  discarded. Malformed raw list data fails the whole page with `503`.
- [ ] Prove cursor-row deletion, newer insertion, block/unfriend/removal after
  cursor minting, empty authorised list `200`, stale actor or
  profile binding `404`, database failure `503`, and no memory fallback.
- [ ] Run projection, store, migration, relationship, and legacy boundary tests.
- [ ] Commit as `feat: add signed Social Crew member reads`.

### Task 4: Verified read routes and legacy firewall

**Files:**

- Modify: `lib/socialCrewHttp.ts`
- Modify: `app/api/social/crews/route.ts`
- Modify: `app/api/social/crews/[crewId]/route.ts`
- Create: `__tests__/socialCrewReadRoutes.test.ts`
- Modify: `__tests__/socialCrewLegacyPlanBoundary.test.ts`
- Modify: `__tests__/socialCrewLegacyPlanCollaborationBoundary.test.ts`
- Modify: `__tests__/writeSurfaceCertification.test.ts` only if route shape
  changes its existing mutation certification.

**Produces:** Private detail and member-list GET routes with stable errors.

- [ ] Add route RED tests proving verified actor resolves before params, query,
  or headers; strict query keys; lane fixed to `member`; bounded `limit` from 1
  through 50; invalid cursor `422`; dependency `503`; and byte-equal private
  `404` for unknown, private, blocked, and mismatched authority.
- [ ] Add `GET /api/social/crews` without changing existing POST. Return only
  member DTO items and next cursor. Keep `runtime = "nodejs"` and
  `dynamic = "force-dynamic"`.
- [ ] Apply private no-store and `Vary` headers to every route status, including
  `200`, `201`, `400`, `401`, `403`, `404`, `409`, `422`, `429`, and `503`.
  No ETag, `s-maxage`, React cache, or `unstable_cache`.
- [ ] Run RED explicitly:
  `npx vitest run __tests__/socialCrewReadRoutes.test.ts`. Record missing GET,
  query validation, header, and legacy-capability failures before route edits.
- [ ] Prove signed-out old Plan token gets `401`; verified outsider gets the
  same `404` with or without that token; Social GET never forwards legacy
  bearer, query, or body capability; central detail, member identity,
  completion, collaboration reads, and old-capability writes remain unable to
  access a Crew-bound Plan.
- [ ] Run route, cache-header, cursor, projection, store, migration, RLS,
  typecheck, lint, and diff checks.
- [ ] Commit as `feat: add verified Social Crew read routes`.

### Task 5: Slice review and handoff

**Files:**

- Modify: `specs/social-crews/README.md`
- Create:
  `.superpowers/sdd/2026-08-05-verified-social-night-loop/task-7-slice-2-report.md`

- [ ] Run a fresh seven-area gate: projection, cursor, store, routes,
  relationships, PostgreSQL 16, and legacy firewall, followed by RLS,
  typecheck, full lint, and diff checks.
- [ ] Independent review must inspect the atomic snapshot boundary, active
  member non-downgrade, preview allowlist, cursor viewer binding, filtering
  before limit, cache headers, legacy firewall, ACLs, and rollback.
- [ ] Record exact commits and counts. Keep migration and beta off. Mark Slice 2
  complete only after `SPEC COMPLIANT` and `QUALITY APPROVED`.
- [ ] Set Slice 3 as exact next pickup and commit as
  `docs: close Social Crew projected reads`.
