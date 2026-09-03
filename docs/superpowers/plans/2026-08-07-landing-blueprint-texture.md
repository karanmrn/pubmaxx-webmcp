# Landing Blueprint Texture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a quiet engineering-blueprint texture to landing paper sections without changing hero cinema or component markup.

**Architecture:** Keep feature in `components/landing/landing.css`. Theme-derived custom properties control dot and rule colour. Existing landing section selectors receive static backgrounds and decorative pseudo-elements, while existing section labels receive a visual slash prefix with an empty speech alternative.

**Tech Stack:** CSS, Next.js 16, Vitest

## Global Constraints

- CSS only, with no new dependencies.
- Use existing `--font-data` for section labels.
- Respect light theme, dark theme, and `prefers-reduced-motion`.
- Do not modify `components/landing/ThamesHero.tsx` or `components/landing/LandingPage.tsx`.
- Do not modify `app/u/`, `components/identity/`, `components/plan/PlanInviteNextStep`, or `components/onboarding/`.
- Do not commit from this run. GNHF orchestrator owns commits.

---

### Task 1: Blueprint texture CSS contract

**Files:**
- Modify: `components/landing/landing.css`
- Modify: `__tests__/landingChromeCss.test.ts`

**Interfaces:**
- Consumes: landing `--paper`, `--river`, `--line`, and `--font-data` theme tokens
- Produces: static dot ground, section rules with corner ticks, and slash-prefixed `.lpSectionLabel` eyebrows

- [x] **Step 1: Write failing CSS contract test**

Extend `__tests__/landingChromeCss.test.ts` with assertions that paper section selectors use a token-derived radial-gradient ground, decorative section rules include top corner ticks, and `.lpSectionLabel::before` renders `// ` while `.lpSectionLabel` uses `--font-data`.

- [x] **Step 2: Verify test fails**

Run:

```bash
npx vitest run __tests__/landingChromeCss.test.ts
```

Expected: new blueprint texture assertions fail because CSS declarations are absent.

- [x] **Step 3: Add minimal blueprint CSS**

Add theme-derived blueprint variables to `.lp`. Apply static radial-gradient grounds and rule/tick pseudo-elements only to `.lpSignalSection`, `.lpProofSection`, and `.lpCityChooser`. Add a decorative slash prefix with an empty speech alternative to `.lpSectionLabel::before`. Keep all decoration motionless so reduced-motion mode has no movement to disable, while retaining existing global reduced-motion fence.

- [x] **Step 4: Verify focused and voice tests pass**

Run:

```bash
npx vitest run __tests__/landingChromeCss.test.ts __tests__/emDashLaw.test.ts __tests__/frictionVoice.test.ts __tests__/landingPriceHonesty.test.ts
```

Expected: all tests pass.

### Task 2: Browser review

**Files:**
- Verify: landing page at phone and desktop widths in both themes

**Interfaces:**
- Consumes: Task 1 CSS
- Produces: visual evidence that texture stays barely visible, rules do not cover content, and no horizontal overflow appears

- [ ] **Step 1: Start keyless development server**

Run `npm run dev` and open `/` at 390x844 and 1440x900.

- [ ] **Step 2: Review both themes**

Check dot density, rule contrast, label prefix, corner ticks, focus styles, and horizontal overflow in light and dark themes. Stop server after review.

- [ ] **Step 3: Correct only confirmed texture defects**

If review finds a defect, add one failing contract assertion when practical, then change only `landing.css` and repeat focused tests.

### Task 3: Feature gate and PR

**Files:**
- Verify: full repository

**Interfaces:**
- Consumes: reviewed Feature 1 diff
- Produces: open `feat/blueprint-texture` PR against `main`

- [ ] **Step 1: Run required voice fences**

Run:

```bash
npx vitest run __tests__/emDashLaw.test.ts __tests__/frictionVoice.test.ts __tests__/landingPriceHonesty.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run project gate**

Run `npm run verify`. Expected: exit 0.

- [ ] **Step 3: Review protected-file and generated-file state**

Run `git diff --name-only` and confirm protected files are absent. Restore generated tooling churn only if a validation command changed it.

- [ ] **Step 4: Create PR after orchestrator commit**

On branch `feat/blueprint-texture`, push and open PR against `main` with a `feat:` title, what/why body, and exact test results. Never merge.
