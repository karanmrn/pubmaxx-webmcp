# Task 7 Slice 1 handoff

## Status

Slice 1 authority foundation is complete and independently approved. Last code
commit: `12c451ccd fix: bind Crew child mutations to parent`.

No hosted migration, push, deployment, or beta enablement occurred.

## Delivered authority

- Stable Social account and profile ownership, reciprocal friendship, and
  either-direction block authority.
- Durable Crew, member, invitation, Join Request, idempotency receipt, and
  immutable Plan-member binding schema.
- Crew-bound Plan firewall across legacy reads, capabilities, collaboration,
  actions, completion, and metadata updates.
- Durable-only Crew store with fail-closed row projection and private denial.
- Verified private Crew routes with actor-first checks, bounded strict bodies,
  stable error mapping, and per-handler write certification.
- Parent-scoped invitation and Join Request mutations from route through SQL.
- PostgreSQL 16 forward, race, ACL, and exact rollback catalog proof.

## Commit range

- `b7ff818b6` relationship authority
- `d81ef0fff` relationship input validation
- `f95008102` Crew schema foundation
- `72bc4d3c7` legacy Plan boundary
- `f76cd4001` keyless missing-Plan handling
- `ac5f7aec7` Crew domain and durable store
- `a94cac50c`, `f81bf01fa`, `e0b3108ad` store authority fixes
- `5b1931d00`, `807ed5032` verified routes and handler certification
- `8d6fccbf4` final authority review fixes
- `12c451ccd` parent-scoped child mutations

## Final evidence

- Final seven-file Slice 1 gate: 165 tests passed.
- PostgreSQL migration suite: 30 tests passed.
- RLS and rollback harness: 36 tests passed.
- TypeScript: passed.
- Full ESLint: exit 0 with 33 pre-existing warnings outside Slice 1 files.
- Focused ESLint: passed with no findings.
- Diff check: passed.
- Final scoped reviews: `SPEC COMPLIANT`, `QUALITY APPROVED`.

## Remaining conditions

- Migration 0075 remains unapplied. Captain applies it only after all eight
  Social Crew slices pass final review.
- Social beta stays off.
- Structural `server-only` enforcement for the bound-Plan helper and explicit
  header-order instrumentation remain accepted Minor test and structure debt.
  Current import graph and route order are server-only and actor-first.
- Task 6 release findings are outside this Slice 1 handoff and remain governed
  by the Task 6 report.

## Next pickup

Implement [Slice 2](../../../specs/social-crews/slices/02-projection.md) from
`12c451ccd`. Reuse the Slice 1 authority and projection owners. Start with RED
tests for member, friend preview, private denial, current relationship loss,
and dependency failure. Do not add a second Crew read or DTO path.
