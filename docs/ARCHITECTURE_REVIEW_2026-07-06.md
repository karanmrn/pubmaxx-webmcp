# Architecture Review — PUBMAXXING

Date: 2026-07-06
Reviewer: Claude (architecture pass)
Scope: `lib/` store seams, complexity hotspots, `app/api/**` conventions, test architecture, quality gates.
Constraint honoured: hot, co-developed tree (Codex has live WIP). Applied only the two safest, highest-value fixes; everything else is a recommendation.

---

## What was APPLIED (this commit)

1. **PubMap.tsx complexity fix** — the ESLint `complexity 38 > 35` pre-existing warning is now GONE (function under budget). Two behaviour-preserving extractions:
   - Lifted the mobile bottom-sheet drag gesture (state + 4 pointer handlers + snap→px math) into a new hook `components/map/useSheetDrag.ts`.
   - Lifted three compound-boolean derivations (`hasCrawlArrivalParams`, `shouldOpenPlanningInitially`, `shouldShowOnboarding`) into pure module-level helpers.
   - No behaviour change: the handlers, snap math, and boolean conditions are identical; only their location moved off the component body's decision-point budget.
2. **`__tests__/pintDrops.test.ts` env-pinning fix** — the ONE test that would break Vercel's `NODE_ENV=production` CI. See finding **R1**.

Both verified: `tsc --noEmit` clean, `npm run lint` 0 errors + 0 complexity warnings (whole tree), the touched test 26/26 under **both** dev and `NODE_ENV=production`.

The 5 currently-failing unit tests (`commentsStore.test.ts`, `commentsRoute.test.ts`) are **Codex's uncommitted WIP** — a new `parentId` field on the comment DTO (threaded replies) that the existing DTO-shape tests don't yet expect. Those files (`lib/commentsStore.ts`, `app/api/pint-drops/comments/route.ts`) are Codex-owned and untouched here.

---

## Findings, ranked by risk

### R1 — CRITICAL (fixed): `pintDrops.test.ts` breaks under Vercel's `NODE_ENV=production` — Effort: S (done)
`app/api/pint-drops/route.ts` calls `assertServerEnv()` at **module top-level** (import time). Under a production build, `process.env.NODE_ENV` is baked by Vite at transform time, so the test's runtime `vi.stubEnv("NODE_ENV","test")` (in `beforeEach`) is a silent no-op — the route throws its FATAL "Supabase not configured in production" during import, failing the whole suite *before any test runs*.
This is exactly the trap documented in `profileOwnershipRoute.test.ts`. `pint-drops` is the only route with an *import-time* assertion, so it's the only test that actually breaks (the other 8 `stubEnv` tests hit routes that don't read the guard — see R7).
**Fix applied:** mock the `@/lib/supabase` seam so `isSupabaseConfigured`/`requiresSupabaseStore` are controllable flags (`supaGuard`), and no-op `@/lib/serverEnv`'s `assertServerEnv` (a pure startup guard with no bearing on route behaviour; the 503 durable-store contract is still exercised via the `requiresSupabaseStore` flag). The two prod-only cases now flip the flag explicitly instead of stubbing NODE_ENV.
**Recommendation (one-line):** done — mirror the `profileOwnershipRoute` mock-the-seam pattern; never rely on runtime NODE_ENV stubbing for a value Vite bakes.

### R2 — HIGH: 11 dual-backend stores use 3 divergent backend-selection shapes — Effort: M
Three inconsistent patterns coexist:
- **Factory seam** (single selection point): `commentsStore()`, `notificationsStore()`, `roundsStore()`, `savedPubsStore()`.
- **Dual-export** (caller/route picks at each call-site): `followStore`, `profileStore`, `reactionsStore`, `pintDropsStore`.
- **Inline per-function checks** (no interface at all): `presenceStore` (`markPresence()`, `recentPresence()` each re-check).
Plus an identical `admin()` helper (`getSupabaseAdmin()` → throw if null) duplicated in every Supabase store.
**Risk:** the dual-export/inline stores scatter `isSupabaseConfigured()` across call-sites; a route that forgets the check silently uses the wrong backend. Not urgent, but a footgun.
**Recommendation:** standardise on the factory-seam shape (`xStore()` returns memory|supabase) and extract one shared `requireSupabaseAdmin()` into `lib/supabase.ts`. Do it store-by-store, NOT as a big-bang — see Do-Not-Do.

### R3 — HIGH: `rounds` / `rounds/[code]` return **500** where the rest of the codebase returns **503** for store failures — Effort: S
The near-universal contract is `{ error: "..." }` with 503 when a durable store is unavailable. The rounds routes map store errors to **500** instead. This is an observability/contract inconsistency: a 500 reads as "bug", a 503 as "degraded dependency". Everything else (pint-drops, profiles, crawls, comments, reactions) uses 503.
**Recommendation:** map `RoundWriteError` → 503 (not 500) to match the fail-soft dependency-outage convention.

### R4 — MEDIUM: `PubMapCanvas.tsx` (~1700 lines) is a complexity reservoir — Effort: L (DEFER)
Just hardened and stable; **do not restructure now** (explicitly out of scope). For the record, the cleanest *future* extraction seams, in rough safety order:
1. The MapLibre source/layer *setup* (add-source + add-layer + paint-expression blocks) → a pure `lib/mapLayers.ts` that returns layer specs. Highest value, lowest coupling.
2. The band-overlay + band-picker subtree → its own component (already conceptually separate; PubMap only owns the shareable `activeBandId`).
3. The landmark/POI interaction handlers → a `useMapInteractions` hook mirroring the `useSheetDrag` pattern just applied to PubMap.
Each is independently shippable once the file cools down. None should be attempted while the map layer is under active change.

### R5 — MEDIUM: fail-soft philosophy is applied inconsistently on reads — Effort: M
Most GETs degrade gracefully (empty list / null) rather than 5xx — good, and deliberate. But it's ad-hoc: some stores swallow in try/catch at store level (`savedPubsStore`), some in a helper (`notificationsStore.dropOwnerHandle`), some leave it to the caller (`reactionsStore`). Two routes intentionally *never* error: `last-train` and `heritage` return **200 with an error/empty body** (paid-API cost + demo-must-not-break — legitimate, but they're the outliers worth documenting).
**Recommendation:** document the fail-soft contract once (reads degrade, writes 503/429/400 loudly) and note `last-train`/`heritage` as sanctioned exceptions, so the pattern is a decision not an accident.

### R6 — LOW: `admin/comments` GET has no rate-limit; two routes use `NextResponse.json` vs the majority `Response.json` — Effort: S
- `admin/comments` GET is unlimited (reads-only, admin-gated — low risk, but the only moderation path without a limiter).
- `venue/[id]` and `pint-drops/[id]` use `NextResponse.json()` where every other route uses bare `Response.json()`. Purely stylistic; harmless.
**Recommendation:** normalise to `Response.json()` opportunistically; add a limiter to `admin/comments` GET only if it ever becomes reachable without the admin token.

### R7 — LOW: 8 route tests stub `NODE_ENV` harmlessly but misleadingly — Effort: S
`crawlsSlugRoute`, `reactionsRoute`, `commentsRoute`, `roundsRoute`, `adminCommentsRoute`, `crawlStoryCountByAuthor`, `savedPubsRoute`, `notificationsRoute` all `vi.stubEnv("NODE_ENV", ...)`. Verified: **all 8 pass under `NODE_ENV=production`** because their routes don't read the prod guard at import — the stub is dead code, not a Vercel risk. But it's misleading (implies NODE_ENV matters when it doesn't) and invites cargo-culting the broken pattern into a future guard-gated route.
**Recommendation:** delete the no-op `stubEnv("NODE_ENV")` calls from these 8 tests (or convert to the mock-the-seam pattern) in a dedicated cleanup PR. Low value, deferred to avoid churn in the contended tree — see Do-Not-Do.

### R8 — LOW: `sheetSnapTranslateYPx` / snap-VH map now live in `useSheetDrag.ts` — Effort: none (informational)
The `SHEET_SNAP_VH` fractions in `useSheetDrag.ts` mirror the resting positions in `venueSheet.css` by hand. This is a pre-existing implicit coupling (was in PubMap, now in the hook) — a CSS change to `.sheet-half`/`.sheet-peek` must be echoed here. Called out so the coupling is documented, not hidden by the move.

---

## Do NOT do right now (attractive but wrong in a live co-developed tree)

- **Do NOT big-bang the store refactor (R2).** Migrating all 11 stores to one factory shape in one PR would collide with Codex's live WIP across `ledger.ts`, `spill.ts`, comments, and pint-drops. Do it one store per PR, on stores Codex isn't touching that week.
- **Do NOT restructure `PubMapCanvas.tsx` (R4).** Explicitly out of scope; just hardened. The extraction seams are noted for later — attempting them now fights active map work.
- **Do NOT touch Codex-owned files:** `components/map/PintDropComposer.tsx`, `components/map/usePintDrops.ts`, `lib/ledger.ts`, `lib/spill.ts`, `app/ledger/**`, `components/ledger/**`, `e2e/map-story.spec.ts`, `.github/workflows/ci.yml`, plus the in-flight `lib/commentsStore.ts` + `app/api/pint-drops/comments/route.ts` (threaded-replies WIP). The 5 currently-red comment tests are theirs to green.
- **Do NOT "fix" the 8 harmless `stubEnv` tests (R7) in this pass.** They pass under prod; touching 8 files now is pure churn risk. Batch them into one intentional cleanup PR later.
- **Do NOT convert `last-train`/`heritage` to hard 4xx/5xx (R5).** Their always-200 fallback is a deliberate cost/UX choice, not a bug.

---

## Quality-gate notes (`npm run ci`, coverage, pre-push)

- **CI ordering** is sound: type-check → lint → unit → build. The unit suite's env-safety hole was R1 (the only test that broke under the production build the gate is meant to mirror) — now closed.
- **Pre-push lints the WHOLE tree**, which in a shared workspace means a co-dev's unrelated WIP (e.g. today's red comment tests / a transient complexity warning from Codex's slim-pin additions) can block *your* push. Known friction; the pragmatic mitigation is scoped commits (never `git add -A`) so at least the *commit* is clean even when the tree isn't. No change recommended to the gate itself — whole-tree linting is correct; the friction is a coordination cost, not a defect.
- **Complexity budget (max 35):** PubMap was the only offender and is now under budget. `PubMapCanvas` is large but not flagged (its functions are individually under the per-function threshold; the size is line-count, not cyclomatic). Keep the 35 ceiling — it did its job here.

---

## Test architecture summary

- **Unit (`__tests__/`, vitest):** strong — pure logic (haversine, scoring, validation) + route-level contract tests. The env-pinning convention (mock the `@/lib/supabase` seam, not `NODE_ENV`) is the correct one; R1 brought the last import-time-guarded route into line, R7 flags the remaining no-op stubs for later cleanup.
- **E2E (`e2e/`, Playwright):** flake-resistance via performance-mark signals (`pubmax:first-pins`) and data-loaded gates rather than fixed sleeps — good. `e2e/map-story.spec.ts` is Codex-owned; untouched.
- **Split is clean:** logic + contracts in unit, user journeys in e2e, no overlap-thrash.
