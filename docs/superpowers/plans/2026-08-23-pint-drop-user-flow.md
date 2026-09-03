# Pint Drop User Flow Implementation Plan

> **For agentic workers:** Execute this plan inline with a red-green-refactor test cycle. Keep the slice narrow and preserve the existing Pint Drop and Community Price API contracts.

**Goal:** Make the existing venue-sheet Pint Drop entry usable for a signed-in PUBMAXX user on a fresh device, so an observed Pint Price reaches the existing Pint Drop and price-authority seams.

**Architecture:** Keep the venue sheet's existing price entry and Pint Drop composer. Resolve the composer author from the account-owned handle first, then the browser draft only for keyless/demo use. The existing `/api/price-submit` pairing remains unchanged, and direct Pint Drop posts continue through `/api/pint-drops`. No new table or Visit Report path is introduced.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase auth context, Vitest.

**Spec:** User request for the v0 Pint Drop write flow.

## Global Constraints

- Preserve account ownership: server-derived PUBMAXX User ID and current handle remain authoritative.
- Preserve provenance: a community price and its paired Pint Drop remain separate observations with their existing labels.
- Keep keyless reads and demo seeds working; no new storage backend or table.
- Do not write Visit Reports.
- Run targeted tests only. Do not run full verify or build.
- Leave pre-existing `next-env.d.ts` and `tsconfig.json` tooling churn untouched.

---

### Task 1: Reproduce the venue-sheet gap

**Files:**
- Test: `__tests__/pintDropUserFlow.test.ts`

**Interfaces:**
- Consumes: venue-sheet contribution entry and existing `/api/price-submit` pairing behavior.
- Produces: a failing test that proves the direct venue-sheet action is absent or does not open the existing price form for a signed-in user.

- [x] Write focused failing coverage for the fresh-device account author and the required composer field.
- [x] Run the targeted test and confirm the account-owned author field was initially unavailable.

### Task 2: Make the venue-sheet Pint Drop entry account-aware

**Files:**
- Modify: `components/map/usePintDrops.ts`
- Modify: `components/map/PintDropComposer.tsx`
- Modify: `components/map/composer/ComposerFields.tsx`
- Add: `lib/pintDropComposerIdentity.ts`
- Test: `__tests__/pintDropUserFlow.test.ts`

**Interfaces:**
- Consumes: `useAuth`, the existing venue-sheet Pints entry, and `POST /api/pint-drops`.
- Produces: an account-owned author value in the existing observed-price composer without requiring a browser-local handle.

- [x] Implement the smallest account-aware author seam for the existing venue-sheet composer.
- [x] Ensure preview, optimistic state, and multipart body use the account-owned handle.
- [x] Keep Visit Reports, migrations, and public DTO contracts unchanged.
- [x] Preserve browser-draft keyless/demo behavior.
- [x] Run the targeted regression test.

**Storage note:** `lib/pintDropsStore.ts` currently maps the durable Pint Drop
implementation to Supabase table `visit_reports`; keyless tests and demos use
the existing process-memory store. `lib/oneTapPintDrop.server.ts` calls the
same store for the existing price-pairing path. This slice does not add a
Visit Report domain write, change that backing table, or add a migration.

### Task 3: Review, commit, and push

**Files:**
- Review: changed files and targeted tests only.

- [x] Inspect the diff for unrelated edits and generated tooling churn.
- [x] Run `git diff --check` and the targeted test, recording exact output.
- [ ] Commit the coherent slice on `codex/pint-drop-user-flow` and push it.
- [ ] Report commit SHA, tests, files, and remaining risk to the parent agent.
