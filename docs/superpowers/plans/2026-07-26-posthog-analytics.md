# Privacy-Safe PostHog Analytics Implementation Plan

Historical implementation plan. Current provider and capture boundaries are
owned by `docs/adr/0007-observability-provider-boundaries.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt useful parts of PostHog wizard PR 619 without allowing account identity, free text, location, or unconsented activity to reach PostHog.

**Architecture:** Existing `trackEvent` and `/api/events` remain sole product-event rail, preserving consent, DNT, anonymous ID, and closed-registry enforcement. In this initial adoption, PostHog browser SDK handles only scrubbed anonymous exception counts through an owned first-party `/ingest` transport boundary. Wizard server SDK and direct captures are omitted because existing bounded raw-HTTP forwarder is safer and already production-tested.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, PostHog browser SDK, Next.js route handlers.

## Global Constraints

- Never call `posthog.identify`; no account ID, email, handle, or subscriber address reaches PostHog.
- Product events fire only through `trackEvent` after analytics consent and with DNT off.
- Product event names and properties remain closed in `lib/analyticsEvents.ts`.
- For this task, browser SDK sends only scrubbed `$exception` events, with exception messages, stack traces, URLs, and arbitrary properties removed.
- Keep PostHog EU reverse proxy at `/ingest`.
- Configure only Vercel project `chengdu`; do not touch mirror project `pubmax`.

---

### Task 1: Consent-Gated Exception Client

**Files:**
- Create: `lib/posthogClient.ts`
- Create: `instrumentation-client.ts`
- Modify: `lib/analytics.ts`
- Test: `__tests__/posthogClient.test.ts`

**Interfaces:**
- Consumes: `analyticsCollectionAllowed(): boolean` and `setAnalyticsConsent(granted: boolean): void`.
- Produces: `initializePosthog(consentAllowed: boolean): void`, `syncPosthogConsent(consentAllowed: boolean): void`, and `sanitizePosthogEvent(event): event | null`.

- [x] **Step 1: Write failing exception scrub tests**

Create fixtures containing account email, query token, raw message, and stack frames. Assert non-exception SDK events return `null`; exception output contains only fixed redacted values, safe exception type, and `$process_person_profile: false`.

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- __tests__/posthogClient.test.ts`

Expected: FAIL because `lib/posthogClient.ts` does not exist.

- [x] **Step 3: Implement minimal client**

Initialize PostHog at `/ingest` with `capture_exceptions: true`, `autocapture: false`, pageview/pageleave capture off, session recording disabled, person profiles disabled, feature flags disabled, and default opt-out. Use `before_send` to reject all SDK events except a scrubbed `$exception`.

- [x] **Step 4: Connect consent**

Call `initializePosthog(analyticsCollectionAllowed())` from `instrumentation-client.ts`. After each `setAnalyticsConsent` transition, call `syncPosthogConsent(analyticsCollectionAllowed())`; opt-out must clear PostHog persistence.

- [x] **Step 5: Run tests and verify GREEN**

Run: `npm test -- __tests__/posthogClient.test.ts __tests__/analytics.test.ts`

Expected: PASS.

### Task 2: Closed Wizard Event Registry

**Files:**
- Modify: `lib/analyticsEvents.ts`
- Modify: `components/auth/AuthProvider.tsx`
- Modify: `components/auth/SignInButton.tsx`
- Modify: `app/we-are-out/WeAreOutClient.tsx`
- Modify: `components/identity/IdentityNudge.tsx`
- Test: `__tests__/analyticsEvents.test.ts`

**Interfaces:**
- Consumes: `trackEvent(name, props?)`.
- Produces: registry entries `user_signed_in`, `user_signed_out`, `sign_in_initiated`, `check_in_created`, and `email_subscribed`.

- [x] **Step 1: Write failing registry tests**

Assert five wizard names sanitize successfully; `sign_in_initiated` accepts only fixed `google` or `microsoft` provider values; other four events discard every property.

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- __tests__/analyticsEvents.test.ts`

Expected: FAIL because names are absent.

- [x] **Step 3: Add minimal registry entries**

Add provider strings to fixed safe vocabulary. Give only `sign_in_initiated` a `provider` property; all other wizard events carry no properties.

- [x] **Step 4: Wire successful user actions**

Use `trackEvent` only. Capture auth transitions without user data, provider button actions with enum provider, and successful client-side check-in/email responses with no response or form properties.

- [x] **Step 5: Run tests and verify GREEN**

Run: `npm test -- __tests__/analyticsEvents.test.ts __tests__/analytics.test.ts`

Expected: PASS.

### Task 3: Proxy, Environment Contract, and Dependencies

**Files:**
- Add: `app/ingest/[...path]/route.ts`
- Modify: `next.config.mjs`
- Modify: `proxy.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `__tests__/posthogConfig.test.ts`
- Test: `__tests__/posthogProxyRoute.test.ts`

**Interfaces:**
- Produces: same-origin `/ingest` forwarding to PostHog EU through a route that accepts only bounded bodies and explicit safe transport headers.

- [x] **Step 1: Write failing proxy-boundary tests**

Assert Next config has no ingest rewrite bypass, capture requests drop browser credentials and request metadata, and SDK assets use the EU asset origin.

- [x] **Step 2: Run test and verify RED**

Run: `npm test -- __tests__/posthogConfig.test.ts`

Expected: FAIL because a direct rewrite still owns ingest traffic.

- [x] **Step 3: Add owned proxy and documented public variables**

Add the bounded route, keep it outside the nonce proxy, and forward only fixed safe headers to the EU origins. Keep `skipTrailingSlashRedirect: true`. Document `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` in `.env.example` without committing real secrets.

- [x] **Step 4: Keep minimal SDK dependency**

Install `posthog-js`. Do not install `posthog-node`; existing `capturePosthogEvent` already performs server capture without a second client, queue, or identity seam.

- [x] **Step 5: Run test and verify GREEN**

Run: `npm test -- __tests__/posthogConfig.test.ts __tests__/posthogProxyRoute.test.ts`

Expected: PASS.

### Task 4: Review, Validate, and Commit

**Files:**
- Review all changed files.

**Interfaces:**
- Produces: committed `fm/posthog-analytics` branch ready for firstmate shipping pipeline.

- [x] **Step 1: Run focused tests**

Run: `npm test -- __tests__/posthogClient.test.ts __tests__/posthogConfig.test.ts __tests__/analyticsEvents.test.ts __tests__/analytics.test.ts __tests__/eventsRoute.test.ts`

- [x] **Step 2: Run repository checks**

Run: `npm run lint`, `npm run typecheck`, and `npm test`.

- [x] **Step 3: Review privacy diff**

Search changed code for `identify`, email/handle distinct IDs, direct `posthog.capture`, unsafe exception properties, and unregistered event names. Confirm only anonymous/device IDs remain.

- [x] **Step 4: Preserve generated/local files**

Restore any `next-env.d.ts` or unrelated local tooling churn. Run project `fm-ensure-agents-md.sh` without adding redundant project memory.

- [x] **Step 5: Commit**

Commit normal code and test changes on `fm/posthog-analytics`, append implementation-complete status, and stop for firstmate's `/no-mistakes` shipping instruction.
