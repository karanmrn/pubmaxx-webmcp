# Sol V0 Gate Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep keyless Tonight reads inside their JSON fail-soft contract, keep plan generation failures honest, and remove local Vercel Insights noise.

**Architecture:** Preserve the existing Tonight handler and keyless plan-signing policy. Add regression coverage at the route and client response seams, then use one small JSON-response reader in both plan generators so non-JSON failures cannot become parser text. Mount Vercel Analytics only when the process is a deployed Vercel runtime.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, Chrome DevTools evidence.

## Global Constraints

- Keep `/api/whats-on` at HTTP 200 JSON for upstream or keyless read failures; HTTP 429 remains its only allowed exception.
- Keep keyless plan generation usable when its signing key is available and show the existing signing-unavailable product copy when it is not.
- Product copy uses British English and no em dashes.
- Do not add a password, API key, or raw server/parser text to browser output.
- Commit browser proof screenshots under `docs/proof/`.
- Run at most one full test suite, only after `memory_pressure -Q`, and use targeted tests when free memory is below 35 percent.

---

### Task 1: Lock the keyless Tonight and plan response contracts

**Files:**
- Create: `__tests__/whatsOnRoute.test.ts`
- Create: `__tests__/planApiResponse.test.ts`
- Test: `app/api/whats-on/route.ts`, `lib/whatsOnHandler.ts`, `lib/apiErrorMessage.ts`

**Interfaces:**
- `GET /api/whats-on` returns a JSON object with `rows` for the keyless Tonight request.
- `readApiJson(response: Response)` returns parsed JSON only for an explicitly JSON response and returns `null` for text or malformed bodies.

- [ ] **Step 1: Write failing tests**

  Add a route test that calls `GET(new Request("http://localhost/api/whats-on?window=tonight&limit=60"))` with the keyless rate-limit store and asserts HTTP 200, JSON content type, and an array of rows. Add response-reader tests for a plain-text 500, a JSON 503, and a malformed JSON response.

- [ ] **Step 2: Run targeted tests to verify the new reader test fails**

  Run `npm test -- __tests__/planApiResponse.test.ts __tests__/whatsOnRoute.test.ts`.

  Expected: the new reader import or behaviour fails because the shared reader does not exist yet; the route contract test records the current baseline.

- [ ] **Step 3: Implement the smallest response seam**

  Add `readApiJson` to `lib/apiErrorMessage.ts`. It must check the response `content-type` before reading the body, return `null` for non-JSON content, and catch malformed JSON. Keep the existing `errorMessageFrom` output unchanged.

- [ ] **Step 4: Run targeted tests to verify the contract**

  Run `npm test -- __tests__/planApiResponse.test.ts __tests__/whatsOnRoute.test.ts`.

  Expected: PASS with the route returning JSON and the reader never exposing plain server text.

- [ ] **Step 5: Commit the contract tests and seam**

  Run `git add __tests__/whatsOnRoute.test.ts __tests__/planApiResponse.test.ts lib/apiErrorMessage.ts && git commit -m "test: lock keyless API response contracts"`.

### Task 2: Guard both plan generators

**Files:**
- Modify: `components/plan/PlanComposer.tsx:912-924`
- Modify: `components/plan/MobilePlanActivation.tsx:140-156`
- Test: `__tests__/planComposerRender.test.ts`, `__tests__/planApiResponse.test.ts`

**Interfaces:**
- Both generators use `readApiJson(response)` before inspecting the body.
- Both non-OK paths call `errorMessageFrom(body, fallback)` and preserve the server’s structured product message.

- [ ] **Step 1: Extend the failing source-contract test**

  Assert that both generator files import and call `readApiJson`, do not call `response.json()` directly in their generation path, and use `errorMessageFrom` for failure copy.

- [ ] **Step 2: Run the focused tests to verify red**

  Run `npm test -- __tests__/planApiResponse.test.ts __tests__/planComposerRender.test.ts`.

  Expected: the source-contract assertions fail against the direct `response.json()` calls.

- [ ] **Step 3: Implement the guarded parse**

  Replace each direct parse with `const body = await readApiJson(response)`. Check `response.ok` before accepting generated stops. On failure, pass the parsed JSON or `null` through `errorMessageFrom` and keep the existing fallback copy. Keep successful response validation and stop-count handling unchanged.

- [ ] **Step 4: Run the focused tests to verify green**

  Run `npm test -- __tests__/planApiResponse.test.ts __tests__/planComposerRender.test.ts __tests__/planGenerateRoute.test.ts`.

  Expected: PASS, including the keyless signing-unavailable 503 contract.

- [ ] **Step 5: Commit the plan parsing fix**

  Run `git add components/plan/PlanComposer.tsx components/plan/MobilePlanActivation.tsx __tests__/planApiResponse.test.ts __tests__/planComposerRender.test.ts && git commit -m "fix(plan): hide raw non-JSON generation failures"`.

### Task 3: Suppress local Vercel Insights injection

**Files:**
- Modify: `components/ConsentAwareVercelAnalytics.tsx:18-28`
- Modify: `__tests__/analytics.test.ts:304-320`

**Interfaces:**
- `shouldMountVercelAnalytics` remains false for local development and local production, and true only for production or preview processes identified as Vercel deployments.

- [ ] **Step 1: Add the failing local-production assertion**

  Update the analytics test to assert `shouldMountVercelAnalytics("production", undefined)` is false and `shouldMountVercelAnalytics("production", "1")` is true.

- [ ] **Step 2: Run the focused test to verify red**

  Run `npm test -- __tests__/analytics.test.ts`.

  Expected: the local production assertion fails because production currently mounts Analytics unconditionally.

- [ ] **Step 3: Gate on deployment context**

  Add an optional deployment argument or read the Vercel deployment marker in `shouldMountVercelAnalytics`. Keep consent and DNT checks unchanged. Local production must render nothing.

- [ ] **Step 4: Run the focused test to verify green**

  Run `npm test -- __tests__/analytics.test.ts`.

  Expected: PASS with local production disabled and Vercel production enabled.

- [ ] **Step 5: Commit the Insights fix**

  Run `git add components/ConsentAwareVercelAnalytics.tsx __tests__/analytics.test.ts && git commit -m "fix(analytics): skip Insights outside Vercel"`.

### Task 4: Reproduce and capture browser evidence

**Files:**
- Create: `docs/proof/sol-tonight-first-load.png`
- Create: `docs/proof/sol-tonight-cache-reload.png`
- Create: `docs/proof/sol-tonight-reconnect.png`
- Create: `docs/proof/sol-plan-3-stop-honest-error.png`
- Create: `docs/proof/sol-plan-4-stop-honest-error.png`
- Create: `docs/proof/sol-plan-5-stop-honest-error.png`
- Create: `docs/proof/sol-plan-6-stop-honest-error.png`

**Interfaces:**
- The keyless production server is built in `.next-fix` and served on port `33600`.
- Chrome DevTools captures visible Tonight success/cache/reconnect states and honest plan refusal states without raw parser text.

- [ ] **Step 1: Build and start the keyless candidate**

  Run `PUBMAX_E2E_KEYLESS=1 NEXT_DIST_DIR=.next-fix node scripts/run-with-restored-next-env.mjs npm run build`, then start `PUBMAX_E2E_KEYLESS=1 NEXT_DIST_DIR=.next-fix npm run start -- --port 33600`.

- [ ] **Step 2: Capture Tonight first-load and cache states**

  Use `chrome-devtools-axi` on `/tonight`, save a screenshot after listings render, hard reload, and save a second screenshot showing the cached listings. Use the Network and Offline controls to fail a retry, restore connectivity, and save the healed surface without navigation.

- [ ] **Step 3: Capture 3, 4, 5, and 6 stop outcomes**

  Submit each stop count from `/plan`. Record a usable grounded route if the keyless signing path is available. If it is unavailable, record the honest signing-unavailable product copy. In every screenshot assert that raw `Unexpected token`, `Internal Server Error`, and JSON parser text are absent.

- [ ] **Step 4: Capture console proof for N1**

  On local production, run the browser console check and confirm no `/_vercel/insights/script.js` 404 remains. Keep this result in the PR body alongside the screenshots.

### Task 5: Review, validate, rebase, and open the PR

**Files:**
- Modify: PR description only through `gh-axi`

- [ ] **Step 1: Run the targeted gate**

  Check `memory_pressure -Q`. If free memory is below 35 percent, run targeted tests only and document that decision. Otherwise run the targeted tests, lint, and typecheck. Run no more than one full suite.

- [ ] **Step 2: Inspect the settled diff**

  Run `git diff --check`, inspect `git diff origin/main...HEAD`, confirm no debug logs or generated files are staged, and apply the PUBMAXX code-review checklist to contract, honesty, mobile, reconnect, and evidence requirements.

- [ ] **Step 3: Rebase immediately before the PR**

  Run `git fetch origin main && git rebase origin/main`, then rerun the affected targeted tests if the rebase changes the diff.

- [ ] **Step 4: Commit and publish**

  Commit all remaining source, test, plan, and proof files. Push only `fm/fix-sol-severe-api`, open the PR with `gh-axi`, include the root-cause explanation and proof links, then append `done: PR {url}` to `/Users/karanmanoharan/karan-agent-workspace/state/fix-sol-severe-api.status`.
