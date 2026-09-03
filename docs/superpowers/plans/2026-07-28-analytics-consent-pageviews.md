# Analytics Consent and Pageviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask every first-time visitor for analytics consent and send explicit PostHog pageviews on initial load and App Router pathname navigation.

**Architecture:** A root client component owns the first-visit prompt and reads the existing localStorage consent key after hydration, so first paint and the map remain unblocked. `lib/analytics.ts` persists both `granted` and `denied`; the existing account control remains a withdrawal seam. Shared prompt orchestration gives undecided analytics consent first priority without stacking onboarding. A render-nothing route tracker calls the consent-gated browser client. `lib/analyticsPath.ts` keeps the existing product-event path vocabulary separate from the broader pageview vocabulary, with every allowed dynamic pageview route mapped to a stable template before `before_send` retains only that coarse path and the consent-scoped anonymous id.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostHog JS, Vitest, Playwright.

## Global Constraints

- No new dependency.
- Keep `capture_pageview: false`, `autocapture: false`, `person_profiles: "never"`, `respect_dnt: true`, first-party `/ingest`, and the existing exception sanitisation.
- No account identity, free text, query string, referrer, or precise location reaches browser PostHog pageviews.
- Query-string-only navigation is not a pageview. Only pathname changes count.
- `/admin` and all nested moderation routes are excluded from product pageviews.
- Pre-consent pageview attempts are discarded and never flushed after acceptance.
- Decline and accept use equal controls and both persist.
- Prompt is non-modal, does not delay first paint, and honours `prefers-reduced-motion`.
- Product copy follows `docs/VOICE.md`, uses British spelling, no exclamation mark, and no em dash.
- PostHog dashboard settings remain captain-owned.

---

### Task 1: Persisted First-Visit Consent Prompt

**Files:**
- Create: `components/AnalyticsConsentPrompt.tsx`
- Modify: `lib/analyticsIdentity.ts`
- Modify: `lib/analytics.ts`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `components/profile/PubmaxxAccountHub.tsx`
- Test: `__tests__/analytics.test.ts`
- Test: `__tests__/analyticsConsentPrompt.test.ts`

**Interfaces:**
- Produces: `analyticsConsentDecision(): "granted" | "denied" | null`.
- Consumes: `setAnalyticsConsent(granted: boolean): void`.

- [x] **Step 1: Write failing consent-state tests**

Assert that a fresh browser returns `null`, accepting stores `granted`, declining stores `denied` while deleting the anonymous id and outbox, and either saved answer suppresses prompt markup after the client state resolves.

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- __tests__/analytics.test.ts __tests__/analyticsConsentPrompt.test.ts`

Expected: FAIL because denied consent is removed and prompt component does not exist.

- [x] **Step 3: Implement consent state and prompt**

Add a pure storage reader that accepts only `granted` or `denied`. Change revocation to store `denied` after removing the identifier and verified outbox. Render a root non-modal prompt only when the reader returns `null`, with:

```text
PUBMAXX is bootstrapped. Anonymous counts show which pages and planning tools people use, so we know what to make better. Never sold or used for ads.
```

Provide equal `Allow` and `No thanks` buttons plus a `/privacy` link. Either button saves the choice and hides the prompt. Keep the account setting as the later change-control surface.

- [x] **Step 4: Style without blocking arrival**

Use project tokens, 44px controls, constrained width, safe-area spacing, no backdrop or modal scrim, and transitions only inside `@media (prefers-reduced-motion: no-preference)`.

- [x] **Step 5: Run tests and verify GREEN**

Run: `npm test -- __tests__/analytics.test.ts __tests__/analyticsConsentPrompt.test.ts __tests__/pubmaxxAccountHub.test.ts`

Expected: PASS.

### Task 2: Explicit Safe PostHog Pageviews

**Files:**
- Create: `components/PosthogPageviews.tsx`
- Modify: `lib/posthogClient.ts`
- Modify: `app/layout.tsx`
- Test: `__tests__/posthogClient.test.ts`
- Test: `__tests__/posthogPageviews.test.ts`

**Interfaces:**
- Produces: `capturePosthogPageview(pathname: string, anonymousId: string | null): void`.
- Produces: `analyticsPageviewSurfaceFromPath(path: unknown): string | null`.
- Consumes: `usePathname()` and the existing consent-synchronised PostHog client.

- [x] **Step 1: Write failing pageview privacy and routing tests**

Assert `$pageview` input is reduced to token, anonymous UUID fields, `$pathname`, and `$process_person_profile: false`; query strings and arbitrary SDK properties disappear. Assert pre-consent attempts are discarded. After consent, preserve pathname changes in an ordered bounded queue while the SDK initialises, beginning with the current pathname at acceptance.

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- __tests__/posthogClient.test.ts __tests__/posthogPageviews.test.ts`

Expected: FAIL because browser pageviews are dropped and no route tracker exists.

- [x] **Step 3: Add pageview scrubber and explicit capture**

Leave the existing exception branch equivalent. Add a `$pageview` branch that validates the consent-scoped anonymous id and maps only closed, known routes to static paths or stable templates. Reject queries, fragments, encoded values, unknown paths and every `/admin` route. Keep `capture_pageview: false`. Discard all pre-consent attempts. After consent, retain coarse pathname changes in an ordered bounded queue while the dynamic SDK import is pending, then send them after `opt_in_capturing`.

- [x] **Step 4: Mount App Router tracker**

Mount a client component under `Suspense` in `app/layout.tsx`. On each `usePathname()` change, call `capturePosthogPageview(pathname, anonymousAnalyticsId())`. Query-string-only navigation intentionally does nothing. Duplicate renders of the same route in strict mode must not duplicate the event.

- [x] **Step 5: Run tests and verify GREEN**

Run: `npm test -- __tests__/posthogClient.test.ts __tests__/posthogPageviews.test.ts __tests__/analyticsCrossTabConsent.test.ts`

Expected: PASS.

### Task 3: Legal Truth and Browser Acceptance

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `__tests__/legalPages.test.ts`
- Create: `e2e/analytics-consent.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Browser acceptance uses a public test PostHog token and intercepts same-origin `/ingest/**`.
- PR body carries captain-owned dashboard values.

- [x] **Step 1: Write failing legal and browser tests**

Update legal assertions to require the first-visit prompt, remembered decline, explicit anonymous pageviews, and later withdrawal in account settings. Add Playwright scenarios proving fresh prompt, stored grant, stored denial, no ingest before consent, `/ingest` after allow, route-change ingest, and no prompt after reload.

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- __tests__/legalPages.test.ts`

Run: `npx playwright test e2e/analytics-consent.spec.ts --project=chromium`

Expected: legal test fails on old account-only description; browser test fails before completed UI wiring.

- [x] **Step 3: Update privacy notice**

Describe the first-visit prompt, the remembered answer, explicit coarse pageviews, and account settings as the later withdrawal control. Update terms to state that analytics are optional and both choices receive the same app.

- [x] **Step 4: Verify mobile UI and capture evidence**

Run the app with test PostHog token, inspect at `390x844x3,mobile,touch`, reduced motion, and both colour schemes. Save light and dark screenshots under a task evidence directory for PR attachment. Confirm prompt controls are at least 44px, no horizontal overflow exists, central map controls remain usable, and declining produces zero `/ingest` requests.

- [x] **Step 5: Record exact PR dashboard handoff**

Add this uncompleted captain action to PR body:

```text
PostHog dashboard, Project settings, Authorized URLs:
- https://pubmaxxing.com
- http://localhost:3000

Do not add https://www.pubmaxxing.com because it permanently redirects to the apex. Do not add a broad *.vercel.app wildcard; add an exact stable preview alias later only if the team uses one.
```

- [x] **Step 6: Run acceptance checks**

Run: `npm test -- __tests__/analytics.test.ts __tests__/analyticsConsentPrompt.test.ts __tests__/posthogClient.test.ts __tests__/posthogPageviews.test.ts __tests__/analyticsCrossTabConsent.test.ts __tests__/legalPages.test.ts`

Run: `npx playwright test e2e/analytics-consent.spec.ts --project=chromium`

Expected: PASS.

### Task 4: Repository Verification and Commit

**Files:**
- Review every changed file.

**Interfaces:**
- Produces committed branch `fm/analytics-actually-works`.

- [x] **Step 1: Review privacy boundary**

Confirm no `identify`, account id, email, handle, free text, query, referrer, or coordinates enter the new pageview payload. Confirm existing exception sanitisation, automatic-capture flags, EU proxy, and DNT behavior remain.

- [x] **Step 2: Run full gate**

Run: `npm run verify`

Expected: PASS, including data validation, lint, typecheck, coverage, and resilient audit.

- [x] **Step 3: Restore local tooling churn**

Restore `next-env.d.ts` and `package.json` only if commands changed them without intentional edits. Preserve unrelated worker changes.

- [x] **Step 4: Check project memory**

Run: `/Users/karanmanoharan/karan-agent-workspace/bin/fm-ensure-agents-md.sh .`

Do not add an AGENTS.md entry because consent and pageview owners are explicit in code, tests, privacy notice, and this plan.

- [x] **Step 5: Commit**

Stage only task files and commit with a normal message, no agent co-author.
