# Remaining PRs and Production Deployment Implementation Plan

> **For the implementation session:** Execute each task in order. Stop integration when a review or verification gate fails.

**Goal:** Review and integrate all safe remaining GitHub work, reconcile local agent work, fix current release blockers, and deploy verified `main` to `pubmaxing.com`.

**Architecture:** Use the clean `pubmax-verify-final` worktree as the integration lane. Preserve the dirty `pubmax` worktree and its backup branch. Repair each pull request on its own head branch, review it again, then merge through GitHub. Promote local backup work only as a small, current-contract-compatible slice. Treat production deployment as a separate final gate after clean verification.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, GitHub, Vercel.

---

### Task 1: Repair and merge PR #1119

- [ ] Replace the prohibited em dash in `components/landing/ThamesHero.tsx`.
- [ ] Run the redirect and Thames Hero regression tests.
- [ ] Re-run Standards and Spec review against the new head.
- [ ] Merge only after required GitHub checks pass.

### Task 2: Resolve stale PR #1106

- [ ] Re-check `docs/overnight-audit.md` against current `main`.
- [ ] Mark the report as a historical snapshot or refresh every stale result.
- [ ] Replace prohibited em dashes.
- [ ] Re-run Standards and Spec review, then merge or close as superseded.

### Task 3: Repair and merge PR #1121 safely

- [ ] Add explicit cost, latency, conflict-risk, worker-count, and approval gates to swarm skills.
- [ ] Replace added em dashes in changed skill files.
- [ ] Verify skill links and changed skill instructions.
- [ ] Re-run Standards and Spec review against the new head.
- [ ] Merge only after review and checks pass.

### Task 4: Reconcile local agent work

- [ ] Keep `/area/{slug}` unpublished because current canonical contract holds it.
- [ ] Do not re-import one-tap `/near` work already present on `main`.
- [ ] Compare contribution-impact and governed drink-landing slices with current contracts.
- [ ] Promote only coherent, tested, non-superseded work through a dedicated PR.
- [ ] Leave generated local skill symlinks uncommitted.

### Task 5: Fix current release blockers

- [ ] Reproduce issue #1104 and repair the surface-read fence from source evidence.
- [ ] Extract issue #1102 last-train logic behind a server module with behaviour-preserving tests.
- [ ] Add a deliberate CI policy for issue #1103, with bounded PR coverage and full scheduled coverage.
- [ ] Run focused tests after each fix and update or close the matching issue with evidence.

### Task 6: Verify and merge integration

- [ ] Run `npm run lint` and `npm run typecheck`.
- [ ] Run `npm run verify` and fix every release-gate failure.
- [ ] Run the production build in the isolated distribution directory.
- [ ] Push the integration PR and merge it after checks pass.
- [ ] Confirm local `main` and `origin/main` point to the same commit.

### Task 7: Deploy and inspect production

- [ ] Deploy the verified `main` commit to Vercel production.
- [ ] Confirm the production alias resolves to `pubmaxing.com`.
- [ ] Navigate the home, map, About, redirected Story, and governed drink paths in Chrome.
- [ ] Repeat critical navigation at a real 390 x 844 mobile viewport.
- [ ] Record final commit, deployment URL, production alias, and verification evidence.
