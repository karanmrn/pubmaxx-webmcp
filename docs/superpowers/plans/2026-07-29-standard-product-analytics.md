# Standard Product Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect consent-gated standard product analytics that can answer unique-device and retention questions without enabling autocapture or session recording.

**Architecture:** Keep named product events on `trackEvent` and `/api/events`, where the closed registry and server validation remain authoritative. Configure PostHog browser persistence and person processing for the consent-created PUBMAXX device ID, allow only explicit SDK system events, and add bounded browser/request context to server-forwarded named events. Keep `/ingest`, DNT, consent withdrawal, and hashed rate limiting.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, posthog-js.

## Global Constraints

- Analytics remain off until explicit consent and stop when DNT is enabled.
- Keep `respect_dnt: true` and the first-party `/ingest` proxy.
- Keep `autocapture: false` and session recording disabled.
- Named product events must pass the closed registry on client and server.
- Never attach account IDs, handles, email, messages, free text, or precise location.
- Event retention is 12 months from collection; person/device records are deleted 12 months after last activity.
- Do not publish exact retention sentences until PostHog project retention is explicitly set and verified.

---

### Task 1: Persistent PostHog Device Identity and Standard SDK Context

**Files:**
- Modify: `lib/posthogClient.ts`
- Modify: `__tests__/posthogClient.test.ts`
- Modify: `__tests__/posthogPageviews.test.ts`

**Interfaces:**
- Consumes: consent-created `ANONYMOUS_ANALYTICS_STORAGE_KEY`.
- Produces: persistent PostHog device identity, person profiles, standard device/referrer/campaign context, and `$web_vitals`.

- [x] **Step 1: Write failing tests**

Assert the stored PUBMAXX analytics ID seeds PostHog device identity across module loads; browser config uses `localStorage+cookie`, `person_profiles: "always"`, and enables referrer, campaign, and performance capture; the browser boundary keeps standard device properties on explicit pageviews while rejecting `$autocapture` and unregistered custom events.

- [x] **Step 2: Run test and verify RED**

Run: `npm test -- __tests__/posthogClient.test.ts __tests__/posthogPageviews.test.ts`

Expected: FAIL on memory persistence, disabled person profiles/context, and stripped device properties.

- [x] **Step 3: Implement minimal client changes**

Seed device ID from consent-created storage, enable required standard options, and keep a closed SDK system-event boundary for `$pageview`, `$exception`, and `$web_vitals`. Preserve standard context while keeping exception messages and stacks redacted.

- [x] **Step 4: Run test and verify GREEN**

Run: `npm test -- __tests__/posthogClient.test.ts __tests__/posthogPageviews.test.ts`

Expected: PASS.

### Task 2: Server-Validated Product Event Context

**Files:**
- Modify: `lib/analytics.ts`
- Modify: `app/api/events/route.ts`
- Modify: `lib/posthogServer.ts`
- Modify: `lib/supabase.ts`
- Modify: `__tests__/analytics.test.ts`
- Modify: `__tests__/eventsRoute.test.ts`

**Interfaces:**
- Consumes: browser screen/viewport/referrer context plus trusted request headers.
- Produces: PostHog named-event properties for IP, user agent, referrer, screen, and viewport, validated at the route boundary.

- [x] **Step 1: Write failing tests**

Assert a consented known event includes bounded browser context, the route ignores malformed context, PostHog receives request IP/user-agent/referrer without logging raw IP, unknown event names still never forward, and DNT still suppresses collection.

- [x] **Step 2: Run test and verify RED**

Run: `npm test -- __tests__/analytics.test.ts __tests__/eventsRoute.test.ts`

Expected: FAIL because browser context is absent and the server capture payload does not include request metadata.

- [x] **Step 3: Implement minimal context collection and validation**

Add bounded primitive context to beacon payloads, validate it independently on the server, forward request IP only to consent-gated PostHog capture, and rewrite route/source comments to match shipped behavior.

- [x] **Step 4: Run test and verify GREEN**

Run: `npm test -- __tests__/analytics.test.ts __tests__/eventsRoute.test.ts`

Expected: PASS.

### Task 3: Accurate Analytics Legal Copy Except Verified Retention Sentences

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `app/terms/page.tsx`
- Modify: `__tests__/legalPages.test.ts`

**Interfaces:**
- Describes: persistent device ID, person/device records, browser/OS/device/screen/referrer/campaign/performance context, PostHog IP receipt, DNT, consent controls, and disabled autocapture/session recording.

- [x] **Step 1: Write failing legal truth tests**

Assert analytics paragraphs disclose every collected category and no longer claim person profiles, browser persistence, referrer, or PostHog IP processing are absent.

- [x] **Step 2: Run test and verify RED**

Run: `npm test -- __tests__/legalPages.test.ts`

Expected: FAIL against July privacy-minimal wording.

- [x] **Step 3: Rewrite analytics paragraphs only**

Update only analytics-related privacy and terms prose. Leave exact 12-month retention sentences pending verified project configuration.

- [x] **Step 4: Run test and verify GREEN**

Run: `npm test -- __tests__/legalPages.test.ts`

Expected: PASS for collection truth tests, with retention verification still external.

### Task 4: Verification and External Retention Gate

**Files:**
- Review all changed files.

**Interfaces:**
- Produces: locally verified implementation awaiting only PostHog retention configuration and matching legal sentences.

- [x] **Step 1: Run focused analytics tests**

Run: `npm test -- __tests__/posthogClient.test.ts __tests__/posthogPageviews.test.ts __tests__/analytics.test.ts __tests__/analyticsCrossTabConsent.test.ts __tests__/analyticsEvents.test.ts __tests__/eventsRoute.test.ts __tests__/posthogProxyRoute.test.ts __tests__/legalPages.test.ts`

- [x] **Step 2: Run repository checks**

Run: `npm run lint`, `npm run typecheck`, and `npm test`.

- [x] **Step 3: Review scope and generated files**

Inspect `git diff`, confirm autocapture/session recording remain off, no unregistered event bypass exists, no raw IP enters logs/storage, and restore local `next-env.d.ts` or `package.json` tooling churn if present.

- [x] **Step 4: Stop at retention gate**

Report local implementation complete except exact `/privacy` and `/terms` retention sentences. Do not commit or claim task completion until PostHog project setting is verified and both sentences are added.
