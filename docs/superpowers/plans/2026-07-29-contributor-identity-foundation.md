# Contributor Identity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind community contributions to authenticated public handles while
collecting the captain-approved private signup profile without imposing an age
gate.

**Architecture:** Public identity remains the account-owned profile handle.
Date of birth, optional full name, and optional sex live only in
`private_account_identities`; contribution authorization checks account and
completed profile ownership, never age. Existing Round promotion, handle claim,
and account-snapshot boundaries remain unchanged.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase PostgreSQL,
Vitest, Playwright.

## Global Constraints

- Date of birth is required to finish signup and stored as a private profile
  field.
- Full name and sex are optional, stored privately, and editable later.
- Nobody is blocked at any age and no adult eligibility state is derived.
- Handle is the only public identity.
- Privacy and Terms must describe collection, purpose, visibility, retention,
  and deletion in the same commit as behavior.
- Preserve account-bound prices and venue signals, legacy handle claims,
  reserved handles, magic link, provider availability, and Round promotion
  fixes.
- Visit Reports and Recommendations remain explicit follow-up work.
- Keep onboarding one screen and usable at 390px.

---

### Task 1: Pin final private profile contract

**Files:**
- Modify: `__tests__/accountOnboarding.test.ts`
- Modify: `__tests__/identityOnboardingRoute.test.ts`
- Modify: `__tests__/privateIdentityStore.test.ts`
- Modify: `__tests__/privateIdentitySupabaseStore.test.ts`
- Delete: `__tests__/contributionAgeRoute.test.ts`

**Interfaces:**
- Consumes: `AccountOnboardingForm`, `PrivateIdentityStore.completeOnboarding`
- Produces: required `dateOfBirth: string` onboarding contract with optional
  `fullName` and `sex`

- [ ] **Step 1: Write failing signup tests**

  Render onboarding with an empty date, assert claim actions stay disabled,
  render with `1990-01-01`, and assert field order is handle, date of birth,
  full name, sex. Route and store tests submit literal dates and assert the
  private record keeps that exact date.

- [ ] **Step 2: Run tests to verify RED**

  Run:
  `npm test -- __tests__/accountOnboarding.test.ts __tests__/identityOnboardingRoute.test.ts __tests__/privateIdentityStore.test.ts __tests__/privateIdentitySupabaseStore.test.ts`

  Expected: failures show missing date input, handle-only signup succeeding,
  and missing `date_of_birth` persistence.

- [ ] **Step 3: Implement private field storage**

  Replace derived age fields with:

  ```ts
  type PrivateIdentityRecord = {
    dateOfBirth: string;
    fullName?: string;
    sex?: PrivateIdentitySex;
    createdAt: string;
    updatedAt: string;
  };
  ```

  Export date cleaning from `lib/privateIdentity.ts`, validate before claiming
  a handle, pass `p_date_of_birth` to the durable RPC, and persist
  `date_of_birth date not null`.

- [ ] **Step 4: Implement one-screen signup**

  Add required `type="date"` input between handle and optional fields. Send
  date of birth in both normal and "Skip optional details" submissions. Keep
  both actions disabled until exact handle availability and valid date are
  established.

- [ ] **Step 5: Run focused tests to verify GREEN**

  Repeat Step 2. Expected: all selected tests pass with no warnings.

### Task 2: Remove contribution age gating

**Files:**
- Modify: `lib/contributionIdentity.server.ts`
- Modify: `components/identity/ContributionGateDialog.tsx`
- Delete: `app/api/identity/contribution-age/route.ts`
- Modify: `__tests__/contributionGateState.test.ts`
- Modify: `__tests__/contributionGateSurface.test.ts`
- Modify: `__tests__/priceSubmitRoute.test.ts`
- Modify: `__tests__/roundsRoute.test.ts`
- Modify: `e2e/price-submission.spec.ts`

**Interfaces:**
- Consumes: completed private profile plus account-owned handle
- Produces: contribution failures limited to `sign_in_required` and
  `onboarding_required`

- [ ] **Step 1: Write failing authorization tests**

  Replace age-block tests with an under-18 signup date that successfully writes
  a price and venue signal. Remove age dialog expectations and assert the gate
  surface contains neither age collection nor under-18 blocking.

- [ ] **Step 2: Run tests to verify RED**

  Run:
  `npm test -- __tests__/contributionGateState.test.ts __tests__/contributionGateSurface.test.ts __tests__/priceSubmitRoute.test.ts __tests__/roundsRoute.test.ts`

  Expected: current resolver returns `age_restricted` or current UI still
  exposes age-assessment modes.

- [ ] **Step 3: Remove gate implementation**

  Delete the contribution-age route. Remove adult assessment methods and state,
  age modes, pending retries, age form, and age analytics. Resolve a contributor
  from authenticated profile plus stored signup identity only.

- [ ] **Step 4: Run focused tests to verify GREEN**

  Repeat Step 2. Expected: signed-in profiles contribute regardless of date of
  birth; sign-in and onboarding failures remain actionable.

### Task 3: Make published data practice exact

**Files:**
- Modify: `app/privacy/page.tsx`
- Modify: `app/terms/page.tsx`
- Modify: `__tests__/legalPages.test.ts`
- Modify: `docs/WRITE_SURFACE_CERTIFICATION.md`
- Modify: `__tests__/writeSurfaceCertification.test.ts`

**Interfaces:**
- Consumes: final storage and deletion behavior
- Produces: exact public notice and certified mutation inventory

- [ ] **Step 1: Write failing legal and inventory tests**

  Require both legal pages to state required date of birth, optional full name
  and sex, analytics/social-feature purpose, private visibility, retention
  until edit/clear or profile deletion, and no age block. Reduce the mutation
  inventory by one after deleting the contribution-age route.

- [ ] **Step 2: Run tests to verify RED**

  Run:
  `npm test -- __tests__/legalPages.test.ts __tests__/writeSurfaceCertification.test.ts`

  Expected: old discarded-date, eligibility, and under-18 statements fail.

- [ ] **Step 3: Update legal copy and certification**

  State that date of birth remains until profile deletion, optional details
  remain until edited, cleared, or profile deletion, all three stay private,
  and all are used for product analytics and social features. Remove every age
  restriction. Remove contribution-age route from certification inventory.

- [ ] **Step 4: Run tests to verify GREEN**

  Repeat Step 2. Expected: both tests pass.

### Task 4: Verify and commit captain policy

**Files:**
- Verify all files changed in Tasks 1-3

**Interfaces:**
- Consumes: completed implementation
- Produces: one behavior-and-legal commit atop pipeline head

- [ ] **Step 1: Run scoped regression suite**

  Run all identity, contribution-gate, price, Round, deletion, legal, and
  write-surface tests touched by the policy.

- [ ] **Step 2: Run static verification**

  Run `npm run lint` and `npm run typecheck`.

- [ ] **Step 3: Inspect diff**

  Confirm no public response contains date of birth, full name, or sex; no age
  endpoint or under-18 branch remains; Round and account snapshot changes are
  untouched.

- [ ] **Step 4: Commit**

  Commit implementation, tests, migration, Privacy, Terms, and certification
  together with:

  ```bash
  git commit -m "fix: collect private signup profile without age gating"
  ```

- [ ] **Step 5: Revalidate**

  Start a fresh no-mistakes validation with final captain policy in intent and
  drive every synchronous gate until corrected PR checks pass.
