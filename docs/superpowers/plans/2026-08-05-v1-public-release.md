# PubMaxxing V1 Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public V1 whose private-memory, voice-quota, price, offline-action, profile-reaction, and mobile-obstruction claims are true and release-safe.

**Architecture:** Three isolated branches own disjoint seams: database and authorization, trust-bearing data presentation, and mobile UI/accessibility. A fourth release branch contains this plan and receives reviewed commits only after focused tests pass. Existing MapLibre scene, Plan intake, scheduler, community signals, Visit Reports, and Fable skill work remain untouched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL/Supabase RLS, Vitest, Playwright, CSS, Vercel.

## Global Constraints

- Base every branch on `origin/main` commit `f78593a247506f7fc6e492fcd2a72ae2d0600f3f`.
- Use test-driven development: add one failing behavior test, run it red, implement minimum change, run it green.
- Never edit existing applied migration `20260803202000_0067_rls_wave2_owner_policies.sql`; add a forward migration and rollback SQL.
- Captain applies production migrations. Agents ship and test SQL only.
- Do not touch MapLibre density/collision constants, shared surface-history ownership, Plan intake, scheduler implementation, or PR #724 skill files.
- No em dashes in source, tests, copy, commits, or documentation.
- Production release requires `npm run ci`, browser checks at 320px, 390px, 430px, and desktop, a reviewed PR, and a verified Vercel production deployment.

---

### Task 1: Security and identity release boundary

**Owner worktree:** `.codex-worktrees/v1-security`

**Files:**
- Create: `supabase/migrations/20260806035204_0070_v1_release_security.sql`
- Create: `supabase/migrations/rollback/20260806035204_v1_release_security_rollback.sql`
- Modify: `app/api/pub-pal/voice-token/route.ts`
- Modify: `__tests__/rlsWave2Policies.test.ts` only when its all-migration expectations need the new final state
- Create: `__tests__/v1ReleaseSecurityMigration.test.ts`
- Create or modify: focused voice-token route test beside other route tests
- Verify without unnecessary edits: `lib/profileOwnership.ts`, `lib/profileStore.ts`, `__tests__/gateHandleAction.test.ts`, and Clerk account controls

**Interfaces:**
- Consumes: existing service-role Night Memory APIs and `consume_pub_pal_voice_trial` RPC.
- Produces: authenticated browser roles cannot mutate publication-sensitive Night Memory rows or voice counters; provider allocation occurs only after quota reservation; reserved handles remain unclaimable.

- [ ] **Step 1: Write migration-shape tests that fail on current grants**

Assert final migration revokes authenticated `INSERT`, `UPDATE`, and `DELETE` on `night_memories`, `night_moments`, `night_moment_consents`, `night_stories`, `night_story_contributors`, `night_story_moments`, `night_story_publish_proposals`, and `pub_pal_voice_usage`. Assert service role retains required DML. Assert no authenticated write policy survives for those tables.

- [ ] **Step 2: Run migration tests and confirm expected failure**

Run: `npx vitest run __tests__/v1ReleaseSecurityMigration.test.ts __tests__/rlsWave2Policies.test.ts`

Expected: new final-state assertions fail because migration `0070` does not exist.

- [ ] **Step 3: Add forward and rollback migrations**

Forward migration must revoke browser DML, drop publication-sensitive authenticated write policies, preserve only reads required by signed-in public surfaces, and grant service role explicit DML. Rollback must restore exact pre-0070 grants and policy definitions so effective-RLS rollback proof can compare catalogs.

- [ ] **Step 4: Write voice route test that proves quota reservation precedes provider allocation**

Test call order by making quota reservation fail and asserting provider signed-URL function is never invoked. Add provider-failure coverage proving any introduced reservation-release path runs once.

- [ ] **Step 5: Reorder voice allocation minimally**

Resolve authenticated owner, reserve quota, request provider URL, and release reservation only if provider allocation fails. Keep provider secrets server-only and never accept owner identity from request body.

- [ ] **Step 6: Audit reserved-handle and Clerk findings against current code**

Run existing reserved-handle tests. If current `profileStore.linkUser` and `gateHandleAction` already fail closed, record evidence and make no duplicate change. For Clerk, prove whether production can display Clerk login without a product Supabase session. If yes, hide Clerk controls behind an existing end-to-end integration gate rather than adding a second identity model.

- [ ] **Step 7: Verify and commit**

Run focused migration, voice, handle, auth, and RLS-shape tests; `npm run typecheck`; `git diff --check`.

Commit: `fix(security): close v1 memory and voice write paths`

---

### Task 2: Trust-bearing price, offline, and reaction behavior

**Owner worktree:** `.codex-worktrees/v1-price-truth`

**Files:**
- Modify: `components/plan/NightCrawlMode.tsx`
- Modify: `lib/nightCrawl.ts`
- Modify: `__tests__/nightCrawl.test.ts`
- Modify: `components/drinks/DrinkMenu.tsx`
- Modify: `components/drinks/drinkMenu.css` if present, otherwise the stylesheet already imported by `DrinkMenu.tsx`
- Modify: `lib/drinkMenu.ts`
- Modify: `lib/drinkPriceUpdates.ts`
- Modify: `__tests__/demoContent.test.ts`
- Modify or create: focused DrinkMenu rendering tests
- Modify: `components/profile/ProfileTimeline.tsx`
- Create: focused ProfileTimeline batching test

**Interfaces:**
- Consumes: `DrinkMenuRow.observedAt`, `demoContentEnabled()`, reaction GET limit of 100, Night Crawl mutation result.
- Produces: failed actions roll back with honest copy; sourced menu prices show date and stale language; demo-off removes menu seeds/overlay demo rows; reactions load in bounded batches.

- [ ] **Step 1: Add failing Night Crawl failure-state test**

Assert failed arrive/skip removes optimistic state, leaves cursor unchanged, and renders `That did not save. Try again when you have signal.` Assert no copy contains `will sync` until a real outbox exists.

- [ ] **Step 2: Implement honest rollback and run green**

Keep optimistic immediate feedback, then restore prior state on non-2xx or network error. Retain idempotency key behavior for retries.

- [ ] **Step 3: Add failing sourced-price date and stale-language tests**

For a fresh sourced row assert visible source plus formatted observation date. For a row older than the existing product freshness budget, assert `Last seen` and never `current` or `tonight`.

- [ ] **Step 4: Render trust metadata from the row owner**

Use `DrinkMenuRow.observedAt` directly. Put date adjacent to the price/source, use a semantic `<time dateTime>` element, and preserve named-publisher/licence disclosure.

- [ ] **Step 5: Add failing production demo-off venue-menu test**

With `NEXT_PUBLIC_DEMO_CONTENT=off`, assert `venueMenuForInspector` includes neither `demoDrinksFor` seeds nor overlay rows whose provenance is demo. With flag on, preserve current demo fixtures.

- [ ] **Step 6: Gate both demo seams through `demoContentEnabled()`**

Do not mutate source artifacts. Filter at menu assembly so production-off behavior is deterministic and covered.

- [ ] **Step 7: Add failing reaction batching test**

Render or exercise ProfileTimeline with 205 IDs. Assert three GET requests contain 100, 100, and 5 unique IDs, all response summaries merge, and omitted IDs are not marked local-only.

- [ ] **Step 8: Implement bounded batching**

Chunk requested IDs at the API contract limit. One failed batch may degrade only its own IDs; abort cleanup must not mark anything local-only. Keep POST toggle behavior unchanged.

- [ ] **Step 9: Verify and commit**

Run Night Crawl, DrinkMenu, demo-content, price-presentation, reactions-route, and ProfileTimeline tests; `npm run typecheck`; `git diff --check`.

Commit: `fix(trust): make v1 prices and actions honest`

---

### Task 3: Mobile obstruction and accessibility pass

**Owner worktree:** `.codex-worktrees/v1-mobile-obstructions`

**Files:**
- Modify only after reproduction: `app/today/today.css`, `app/today/TodayGetThereStrip.tsx`, or their direct layout owner
- Modify: `components/pwa/A2HSInstallPrompt.tsx`
- Modify: `components/pwa/a2hsInstallPrompt.css`
- Modify only direct sheet navigation owners: `components/map/venueSheet.css`, `components/map/inspector/VenueInspectorHeader.tsx`
- Modify direct shared-nav owner only if reproduction proves shared defect: `components/nav/mobileNav.css`
- Modify or create: `e2e/mobile-v1-obstructions.spec.ts`
- Modify: `__tests__/mobileChromeFit.test.ts`, `__tests__/venueTabsEdgeFade.test.ts`, and A2HS tests only for behavior actually changed

**Interfaces:**
- Consumes: existing `--tabbar-h`, safe-area tokens, A2HS proven-value gate, semantic venue tablist.
- Produces: no dead panel or hidden content on Today, compact value-earned Android install treatment, reachable Last train tab, readable trust captions, no horizontal overflow.

- [ ] **Step 1: Reproduce current production defects end to end**

At 320px, 390px, and 430px capture Today scroll, Map first value-earned install prompt, selected venue sheet, and lower cards. Record bounding boxes for tab bar, final card, install surface, tablist scroll width, and Last train tab.

- [ ] **Step 2: Add failing browser assertions**

Assert Today content can scroll fully above the fixed tab bar, no intermediate layout block exceeds its rendered content by more than 96px, Android install treatment occupies at most 30% of viewport height and leaves map interactions visible, and `Last train` can be reached by a visible control at 400px.

- [ ] **Step 3: Fix Today at its direct owner**

Remove the reproduced height/min-height/flex cause. Consume shared `--tabbar-h` once. Do not add duplicate safe-area padding at both page and body.

- [ ] **Step 4: Compact only the Android A2HS treatment**

Preserve proven-value and prompt-budget policy. Keep iOS manual instructions in the full instructional sheet. Android gets a compact dismissible card without a full-screen scrim; close and install controls stay at least 44px.

- [ ] **Step 5: Make venue navigation discoverable**

Preserve semantic tabs and horizontal scrolling. Ensure edge fade or a persistent `Train` affordance makes Last train discoverable at 400px. Do not change MapLibre canvas, selection history, or tab labels.

- [ ] **Step 6: Fix confirmed accessibility defects in touched surfaces**

No pointer-blocking non-modal scrim. Focus returns to trigger on dismissal. Loading/status changes use polite live regions. Trust captions wrap and never ellipsize.

- [ ] **Step 7: Verify and commit**

Run focused Vitest checks and Playwright at 320px, 390px, 430px, and desktop; `npm run lint`; `npm run typecheck`; `git diff --check`.

Commit: `fix(mobile): clear v1 discovery obstructions`

---

### Task 4: Review and integrate into release branch

**Owner worktree:** `.codex-worktrees/v1-release`

- [ ] **Step 1: Request independent review for each task commit**

Reviewer receives exact base SHA, head SHA, task contract, focused test evidence, and changed files. Critical and important findings block integration.

- [ ] **Step 2: Recheck GitHub ownership before each cherry-pick**

Run `gh-axi pr list` and compare changed paths against open PRs and dirty root files. Do not integrate overlapping work without explicit reconciliation.

- [ ] **Step 3: Cherry-pick reviewed commits one lane at a time**

After each lane, run its focused tests plus `npm run typecheck`. Resolve conflicts by preserving current main contracts, never by taking an entire side blindly.

- [ ] **Step 4: Run release verification**

Run `npm run validate-data`, `npm run lint`, `npm run typecheck`, bounded full coverage, `npm run build` with `NEXT_DIST_DIR=.next-prod`, and focused Playwright. Then run `npm run ci` on the exact release tree.

- [ ] **Step 5: Production-like browser QA**

Review `/today`, `/tonight`, `/map`, selected venue Overview/Drinks/Last train, `/plan`, `/feed`, sign-in surface, and Night Crawl failure state in dark and light modes across phone and desktop. Capture screenshots and compare against pre-change evidence.

- [ ] **Step 6: Push reviewed PR and wait for required checks**

Push `codex/v1-release-20260805`, create PR against `main`, and wait until required GitHub checks finish. Do not bypass or waive failures.

- [ ] **Step 7: Integrate and deploy only after explicit release choice**

Use the finishing-a-development-branch decision menu. After merge to production branch, retrieve Vercel deployment through available integration, wait for Ready, then perform read-only production smoke checks. SQL remains unapplied until Captain performs migration step.
