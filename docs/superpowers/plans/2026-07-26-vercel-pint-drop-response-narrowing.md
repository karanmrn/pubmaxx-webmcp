# Vercel Pint Drop Response Narrowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore both Vercel deployments by making the pint-drop route's canonical-validation result narrow to a definite `Response`.

**Architecture:** Keep existing canonical pub validation and route behavior unchanged. Give validation results an explicit boolean discriminator, then narrow the POST route branch on that discriminator.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Vitest

## Global Constraints

- Preserve pub-only Pint Drop submission behavior and canonical venue IDs.
- Preserve PR 620 price-submit hardening and PR 621 corroboration/freshness behavior.
- Do not add venue types, tabs, ratings, colors, bulk imports, or dependency overrides.
- Keep fix limited to root cause of Vercel TypeScript failure.

---

### Task 1: Narrow Canonical Pint Drop Validation Result

**Files:**
- Modify: `app/api/pint-drops/route.ts:279-282`
- Verify: `__tests__/pintDrops.test.ts`

**Interfaces:**
- Consumes: `validateCanonicalPintDrop(fields)`, returning either `{ response: Response }` or `{ value: ValidatedPintDrop }`
- Produces: `{ ok: false, response: Response } | { ok: true, value: ValidatedPintDrop }`, plus a POST route branch where every early return is a definite `Response`

- [ ] **Step 1: Verify failing compiler regression**

Run: `npm run typecheck`

Expected: FAIL at `app/api/pint-drops/route.ts:281` because `canonicalResult.response` is inferred as `Response | undefined`.

- [ ] **Step 2: Apply minimal union-narrowing fix**

Add an explicit boolean discriminator to both result variants, then narrow on it:

```ts
const canonicalResult = await validateCanonicalPintDrop(fields);
if (!canonicalResult.ok) return canonicalResult.response;
const canonicalDrop = canonicalResult.value;
```

- [ ] **Step 3: Verify compiler and route behavior**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm test -- __tests__/pintDrops.test.ts`

Expected: PASS with canonical pub acceptance and non-pub rejection unchanged.

- [ ] **Step 4: Verify CI path and production build**

Run: `NEXT_DIST_DIR=.next-prod npm run ci`

Expected: Data validation, lint, typecheck, and all coverage tests pass. If the
existing dev-only ESLint advisory gate fails, leave dependency policy unchanged
because dependency overrides are outside this change.

Run: `NEXT_DIST_DIR=.next-prod npm run build`

Expected: PASS.

After either command, restore `next-env.d.ts` to:

```ts
import "./.next/types/routes.d.ts";
```
