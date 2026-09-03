# Signed-In Review Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give local reviewers a repeatable authenticated browser session backed by one isolated QA account, without enabling the path on deployed production.

**Architecture:** `lib/e2eReviewAuth.ts` owns the local-only flag and startup safety rule. The service-role seed script creates or resets one marked account, links `e2e_qa` without invoking the founding-member grant, removes QA-owned rows and storage objects before each seed, and stores the generated password in `.e2e/qa-credentials.json`. Playwright keeps its anonymous project and adds a flag-gated authenticated project whose setup signs in through the real handle-password route.

**Tech Stack:** Next.js 16, Supabase Auth and service-role REST APIs, TypeScript, Vitest, Playwright, `tsx`, Markdown.

## Global Constraints

- `PUBMAX_E2E_LOGIN=1` is required for the seed script and authenticated Playwright project.
- The startup guard rejects the flag when `NODE_ENV=production` without an explicit local `VERCEL_ENV=development`, and always rejects `VERCEL_ENV=production`.
- The QA handle is `e2e_qa` and the display name is `QA (automated)`.
- The QA profile insert never sends `founding_member_number`; the seed checks that the value stays null and that the founding-member count is unchanged.
- The seed script never prints the generated password or any service-role credential.
- `.e2e/qa-credentials.json` is gitignored and written with owner-only permissions.
- Seed and teardown refuse when the flag is off, and CI refuses production targets.
- The authenticated smoke test signs in through the existing handle-plus-password UI and loads `/you` through `/u/you`.
- New documentation uses British English and contains no em dash.
- Do not edit generated files or `AGENTS.md` except for one testing-index pointer if needed.

---

### Task 1: Local-only E2E login policy

**Files:**
- Create: `lib/e2eReviewAuth.ts`
- Create: `__tests__/e2eReviewAuth.test.ts`
- Modify: `proxy.ts`

**Interfaces:**
- `isE2ELoginEnabled(env?: NodeJS.ProcessEnv): boolean` returns true only for the exact value `PUBMAX_E2E_LOGIN=1`.
- `assertE2ELoginSafe(env?: NodeJS.ProcessEnv): void` throws for deployed production or production-style local processes without `VERCEL_ENV=development`.

- [ ] **Step 1: Write failing tests** for exact flag handling, production rejection, local production-style allowance, and flag-off no-op.
- [ ] **Step 2: Run** `npx vitest run __tests__/e2eReviewAuth.test.ts` and confirm failure because the policy module does not exist.
- [ ] **Step 3: Implement** the pure policy functions with an error that names `PUBMAX_E2E_LOGIN` and the local-only requirement.
- [ ] **Step 4: Call** `assertE2ELoginSafe()` at `proxy.ts` module startup so every local server and deployed process evaluates the guard.
- [ ] **Step 5: Run** the targeted Vitest file and confirm it passes.

### Task 2: QA seed and teardown

**Files:**
- Create: `scripts/e2e-seed-user.ts`
- Create: `__tests__/e2eSeedPolicy.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- `npm run e2e:seed` creates or resets the QA account and writes `.e2e/qa-credentials.json`.
- `npm run e2e:teardown` deletes QA-owned rows, storage objects, profile, and Auth user, then removes credentials.

- [ ] **Step 1: Write failing policy tests** for the fixed handle, marked name, profile insert payload without a founding-member field, and unchanged founding count assertion.
- [ ] **Step 2: Run** `npx vitest run __tests__/e2eSeedPolicy.test.ts` and confirm failure because the policy module does not exist.
- [ ] **Step 3: Implement** fixed QA constants and pure checks in `lib/e2eSeedPolicy.ts`, then use them from the script.
- [ ] **Step 4: Implement** env loading with `@next/env`, flag and target safety gates, service-role client creation, random password generation, owner-only credential writing, and password reset.
- [ ] **Step 5: Implement** cleanup for Pint Drops and their photos, profile covers and profile images, follows, referrals, social posts, plans, private account rows, and other rows keyed by the QA profile or Auth user. Remove storage objects by explicit keys and profile prefixes.
- [ ] **Step 6: Link `e2e_qa` using a direct profile write** containing only `user_id`, `handle`, and `display_name`; never call the founding-member claim RPC. Read back the profile and founding count before and after, then fail if either changed or the QA row has a number.
- [ ] **Step 7: Add** `e2e:seed` and `e2e:teardown` scripts and ignore `.e2e/`.
- [ ] **Step 8: Run** policy tests and dry safety checks without printing secrets.

### Task 3: Real browser sign-in and Playwright project

**Files:**
- Modify: `components/auth/HandlePasswordSignIn.tsx`
- Modify: `playwright.config.ts`
- Create: `e2e/signed-in-review.spec.ts`

**Interfaces:**
- Stable selectors: `e2e-login-toggle`, `e2e-login-handle`, `e2e-login-password`, and `e2e-login-submit`.
- `PUBMAX_E2E_LOGIN=1 npm run test:e2e` retains the anonymous `chromium` project and adds `chromium-authenticated` for `signed-in-review.spec.ts`.

- [ ] **Step 1: Add selectors** without changing form behaviour.
- [ ] **Step 2: Add** a Playwright project only when `PUBMAX_E2E_LOGIN=1`; keep anonymous projects unchanged.
- [ ] **Step 3: Pass real public Supabase env to the authenticated local server**, set `VERCEL_ENV=development`, and use a separate dist directory and port when needed.
- [ ] **Step 4: Add** one smoke spec that reads `.e2e/qa-credentials.json`, opens `/login`, signs in through the UI, visits `/u/you`, and asserts `@e2e_qa` or the equivalent handle rendering.
- [ ] **Step 5: Run** the smoke spec with a seeded local credential file and record any PostgreSQL shared-memory contention separately from application failures.

### Task 4: Reviewer documentation

**Files:**
- Create: `docs/testing/signed-in-review.md`
- Modify: `README.md`

- [ ] **Step 1: Document** exact build, seed, authenticated Playwright, Chrome DevTools, and teardown commands, including `VERCEL_ENV=development` for local production-style servers.
- [ ] **Step 2: Document** credential-file handling, safety gates, no founding-member number, cleanup scope, and the one full-suite validation budget.
- [ ] **Step 3: Add** one concise pointer in README's testing command section.
- [ ] **Step 4: Check** every new link and scan new prose for production secrets and em dashes.

### Task 5: Validation and delivery

**Files:**
- Review all changed files and generated-output status.

- [ ] **Step 1: Run** targeted Vitest tests, lint, and typecheck while iterating.
- [ ] **Step 2: Run** the authenticated smoke test and anonymous smoke test.
- [ ] **Step 3: Run** the full suite once with `npm test`, within the 30-minute budget.
- [ ] **Step 4: Perform** shape, diff, and docs review; fix findings and rerun affected checks.
- [ ] **Step 5: Run** fresh completion verification, commit the branch, then run `git fetch origin main && git rebase origin/main` immediately before opening the PR.
- [ ] **Step 6: Push** `fm/review-signed-in-harness`, open the PR with `gh-axi`, append the PR URL to the status file, and stop.
