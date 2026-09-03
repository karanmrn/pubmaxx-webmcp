# Canonical Auth Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every deployed authentication attempt returns through `https://pubmaxxing.com/auth/callback`, while local development continues to use its local origin.

**Architecture:** Keep the canonical production origin and its validation in one shared configuration module. Vercel production and preview builds remain runnable when `NEXT_PUBLIC_SITE_URL` is missing, malformed, insecure, or not the exact apex. Runtime server paths still use `https://pubmaxxing.com` and emit a fatal diagnostic for invalid configuration, while local development stays same-origin. Browser auth opened on a deployment host first moves to the same safe path on the apex, before browser coordination or Supabase can create origin-bound PKCE state.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase Auth, Vitest, Playwright-compatible browser QA.

## Global Constraints

- No new dependency or auth provider.
- Do not change handle or account models.
- Preserve safe same-origin post-auth paths and PKCE attempt coordination.
- Do not change Supabase or Vercel dashboard settings from code.
- Use `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com` as the single configured production site URL.
- Never use em dashes in source or documentation.

---

### Task 1: Lock the canonical callback contract

**Files:**
- Modify: `__tests__/passwordlessAuth.test.ts`

**Interfaces:**
- Consumes: `buildAuthCallbackUrl(currentUrl, requestedNext, attemptId)`
- Produces: Regression coverage proving deployed non-canonical origins cannot enter the provider callback and localhost remains local outside production.

- [x] **Step 1: Write the failing production-host regression test**

Add a test that stubs `NODE_ENV=production` and `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com`, calls `buildAuthCallbackUrl` from `https://chengdu-pubmax69.vercel.app/map?area=soho`, and expects the literal callback `https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho&_authAttempt=<id>`.

- [x] **Step 2: Run the focused test and verify red**

Run: `npx vitest run __tests__/passwordlessAuth.test.ts -t "uses the canonical site for deployed auth callbacks"`

Expected: FAIL because callback origin is still `https://chengdu-pubmax69.vercel.app`.

- [x] **Step 3: Add local-development coverage**

Add a test that stubs `NODE_ENV=development`, calls the same function from `http://localhost:3000/map`, and expects `http://localhost:3000/auth/callback`.

### Task 2: Enforce one canonical deployed auth origin

**Files:**
- Create: `lib/siteUrlConfig.mjs`
- Create: `lib/siteUrl.ts`
- Create: `types/siteUrlConfig.d.ts`
- Create: `__tests__/siteUrl.test.ts`
- Modify: `next.config.mjs`
- Modify: `lib/authRedirect.ts`
- Modify: `components/auth/AuthProvider.tsx`
- Modify: `__tests__/passwordlessAuth.test.ts`
- Modify: `__tests__/socialConnectionsRoutes.test.ts`
- Modify: `app/api/social-connections/[provider]/route.ts`
- Modify: `app/api/social-connections/[provider]/callback/route.ts`

**Interfaces:**
- Produces: Shared canonical-origin validation for runtime callbacks and browser auth startup, plus regression coverage that configuration cannot block deployed builds.
- Consumes: `NEXT_PUBLIC_SITE_URL`, with `https://pubmaxxing.com` as the only deployed origin.

- [x] **Step 1: Own deployed configuration in one module**

Define the canonical apex and validation in `lib/siteUrlConfig.mjs`. Keep `next.config.mjs` free of site URL assertions so Vercel production and preview builds remain runnable when `NEXT_PUBLIC_SITE_URL` is missing, malformed, insecure, or not the exact `https://pubmaxxing.com` origin.

- [x] **Step 2: Preserve runtime sign-in through misconfiguration**

Return the current HTTP(S) origin outside production. In production, always return `https://pubmaxxing.com`; when configuration is invalid, emit a fatal server-side diagnostic before using that apex fallback. Route auth callback construction and both social OAuth endpoints through this resolver.

- [x] **Step 3: Canonicalise before starting PKCE**

Sanitise the intended post-auth path with the existing redirect safety rules. When browser auth starts on a deployment host, navigate to that safe path on `https://pubmaxxing.com` before reading or writing auth coordination storage, acquiring the browser lock, loading a provider, or minting a Supabase PKCE verifier. Start the coordinated auth attempt only after the user is on the apex. Keep local development on its current origin.

- [x] **Step 4: Cover build, runtime, and browser boundaries**

Add focused coverage for pre-PKCE canonical navigation, callback credential scrubbing, deployed build continuity under invalid configuration, loud runtime apex fallback, social OAuth callback ownership, and unchanged local behavior.

Run: `npx vitest run __tests__/siteUrl.test.ts __tests__/passwordlessAuth.test.ts __tests__/socialConnectionsRoutes.test.ts`

Expected: PASS.

### Task 3: Make deployment configuration exact

**Files:**
- Modify: `.env.example`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `components/auth/SignInButton.tsx`

**Interfaces:**
- Produces: Operator instructions matching code and Supabase callback contract.

- [x] **Step 1: Document the shared production site variable**

Add `NEXT_PUBLIC_SITE_URL=https://pubmaxxing.com` beside browser-auth settings, explaining that deployed builds use it for auth and social callback origins.

- [x] **Step 2: Correct Supabase dashboard instructions**

Specify Site URL `https://pubmaxxing.com`. Specify redirect URLs `https://pubmaxxing.com/auth/callback` and `http://localhost:3000/auth/callback`. Remove `www` and preview callbacks because deployed auth always returns through the apex.

- [x] **Step 3: Explain deployment-host controls**

Document Vercel deployment protection as access control, including its reviewer cost. Document an exact redirect for `chengdu-pubmax69.vercel.app` as canonicalisation, including the cost that the named alias stops showing its deployed build while other preview URLs remain reviewable. Explain that a wildcard deployment redirect would make every preview leave for production.

- [x] **Step 4: Update stale owner comment**

Point the sign-in component at exact canonical callback configuration rather than a generic `<site>` callback.

### Task 4: Browser and repository verification

**Files:**
- Create: `artifacts/auth-canonical-domain/local-sign-in.png`
- Create: `artifacts/auth-canonical-domain/local-link-sent.png`
- Create: `artifacts/auth-canonical-domain/local-callback.png`

**Interfaces:**
- Consumes: Running local application and shipped redirect builder.
- Produces: Browser screenshots and green repository checks.

- [x] **Step 1: Start local app and verify local sign-in**

Run `npm run dev`, open `http://localhost:3000`, use a 390x844 mobile viewport, open sign-in, and capture the local sign-in surface.

- [x] **Step 2: Verify callback navigation in browser**

Open a local `/auth/callback` URL with a safe `next` path and capture the resulting app page, proving the callback route remains local and functional.

- [x] **Step 3: Record dashboard-blocked production verification**

Record that a real magic-link email currently falls back to the configured Vercel Site URL, proving the dashboard defect. Do not claim successful production-session verification until the owner applies the exact Supabase Site URL and redirect allowlist values, then runs a production magic link and captures the canonical address plus signed-in header.

- [x] **Step 4: Run focused and full verification**

Run `npm run verify`. Fix every failure or flaky test encountered.

- [x] **Step 5: Review and prepare commit**

Review repository shape, diff, and documentation. Commit with a message that names the diagnosed Supabase fallback cause and canonical callback fix.
