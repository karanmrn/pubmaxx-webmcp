# Pub Pal Convex containment and migration runbook

Status: containment accepted 2026-07-20. This ruling changes no production
backend and migrates no remote Supabase or Convex data.

## Boundary decision

Convex is contained to the Pub Pal domain: Pal profile, explicitly confirmed Pal
memories and preferences, mastery, and unlocks. Supabase Auth remains the
identity provider. Supabase/Postgres remains authoritative for Plan and
collaboration (including completion/PNC), entitlement, social, identity, and all
other core product domains.

The existing Convex `planCompletions` table, functions, DTO, migration entity,
and `plan_completion` flag are frozen pre-ruling scaffolding. They are retained
only to avoid a destructive schema/code removal in this decision. They do not
authorize import, shadow reads, cutover, dual-write, or a Plan runtime path, and
`plan_completion` must remain in `supabase` mode. Cleanup can happen in a
separately reviewed, non-destructive change.

`__tests__/convexContainment.test.ts` pins the current table allow-list and the
Supabase Plan seam. Adding a non-Pal Convex table, capability, or runtime path
requires an explicit owner-approved decision in the canonical Wayfinder map and
a deliberate update to that fence in the same change.

The browser never receives database credentials or provider secrets. Public
Convex functions are read-only and call `ctx.auth.getUserIdentity()` before
querying the compound `ownerIssuer + ownerSubject` index. They return explicit
DTOs rather than raw documents. Consequential writes are internal functions.
The future Next.js BFF bridge must verify the Supabase JWT, authorization, and a
visible confirmation before invoking them.

Do not construct or persist Convex's opaque `tokenIdentifier`. Store the exact
verified JWT `issuer` and `subject`. Never trust either value from browser input.

## Gate 0: prerequisites

1. Create separate Convex development, preview, and production deployments.
2. Rotate Supabase Auth from legacy HS256 to an asymmetric ES256 or RS256 key.
3. Record the exact issuer, audience, algorithm, and JWKS URL. Configure them as
   Convex environment values. Never add signing keys or service-role keys.
4. Prove an expired, forged, wrong-audience, and wrong-issuer JWT is rejected.
5. Generate normal `convex/_generated` bindings after linking a non-production
   deployment. The local `convex/model.ts` builders exist only to preserve
   keyless development before that point.
6. Create feature flags independently for `pal`, `memory`, and `mastery`; valid
   modes are `supabase`, `shadow`, and `convex`. The legacy `plan_completion`
   flag remains hard-off in `supabase` mode.

## Per-capability migration

1. Freeze and version the source-to-target field mapping.
2. Export a bounded page from Supabase through an authenticated server job.
3. Start a `migrationBatches` record with source count and checksum.
4. Import idempotently, retaining `legacyId` and `migrationBatchId`. Convert
   timestamps to Unix milliseconds. Derive identity issuer from configuration,
   not a source row.
5. Compare canonical source and target DTO hashes. Store only hashes and result
   categories in `shadowReadComparisons`; do not log memory text.
6. Run shadow reads without changing the user-visible Supabase response.
7. Require 100% count parity, zero unresolved ownership mismatches, zero missing
   rows, stable P95, and an approved restore rehearsal before cutover.
8. Change reads to Convex for one capability. Keep Supabase writes available for
   a bounded rollback window; avoid open-ended dual-write.
9. Stop the old write path only after the observation window.

Recommended order: Pal appearance/personality, memory, then mastery/unlocks.
Plan Completion and live Plan collaboration are outside this runbook.

## Rollback

1. Flip the capability read flag back to `supabase` immediately.
2. Stop the importer and any dual-write worker.
3. Reconcile writes created after the backfill watermark into Supabase.
4. Run the appropriate paged `rollback*Batch` internal mutation until it returns
   zero. A page is capped at 100 records.
5. Mark the batch `rolled_back`, preserve hashes and metrics, and investigate.
6. Never use `npx convex import --replace` or destructive Supabase commands as a
   rollback mechanism.

## Safety and observability

- Mastery points are derived from the server-owned event table; alcohol or drink
  quantity is not an event and cannot award points.
- Plan Completion is idempotent by `planId` and rejects cross-owner collisions.
- Proposed memories remain separate from approved memories and require an
  explicit resolution command.
- Log operation, duration, count, batch ID, and result only. Do not log JWTs,
  memory values, Pal conversations, access tokens, or service keys.
- Track P50/P95/P99 query and mutation latency, error rate, cache hit rate,
  mismatches, reconnects, and Convex bandwidth by capability.
- Target P95: warm tab under 150 ms perceived, reactive read under 300 ms, normal
  mutation under 500 ms. Roll back on sustained regression or ownership error.

## Remote command guardrail

This repository intentionally provides no deploy/import script. Any future
`npx convex deploy`, `npx convex import`, migration worker, Supabase schema change,
or production flag change requires a separately reviewed execution ticket,
environment confirmation, backup evidence, and explicit owner approval.
