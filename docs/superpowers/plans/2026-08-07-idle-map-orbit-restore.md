# Idle Map Orbit Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore slow idle map orbit with every interaction, visibility, motion, and readiness gate, while limiting camera updates enough to prevent phone tile churn.

**Architecture:** Keep orbit timing and gate transitions in pure `lib/mapOrbit.ts`. Drive MapLibre with small discrete bearing changes at fixed low frequency instead of a continuous `rotateTo` animation. Keep compass decisions pure in `lib/mapCompass.ts`; wire both helpers into current `components/PubMapCanvas.tsx` without changing camera ownership.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL 6, Vitest, Playwright/browser QA.

## Global Constraints

- First orbit starts 6 seconds after pin reveal.
- Orbit restarts 20 seconds after any pointer, wheel, touch, key, compass, or programmatic camera interaction.
- Reduced motion, hidden tabs, and off-screen map canvases suspend orbit.
- Camera steps run at a fixed low frequency and each bearing change has an explicit maximum.
- Phone orbit ships only when both themes show no visible tile flicker. Otherwise orbit is desktop-width only and PR states this.
- README line 10 must describe shipped behavior.
- Use ASD-STE100 Simplified Technical English. Do not use em dashes.

---

### Task 1: Restore pure orbit and compass contracts

**Files:**
- Create: `lib/mapOrbit.ts`
- Create: `lib/mapCompass.ts`
- Create: `__tests__/mapOrbit.test.ts`
- Create: `__tests__/mapCompass.test.ts`

**Interfaces:**
- Produces: `createIdleOrbit(options): IdleOrbit`
- Produces: `ORBIT_DEG_PER_SEC`, `ORBIT_FRAME_INTERVAL_MS`, `ORBIT_MAX_BEARING_STEP_DEG`, `ORBIT_FIRST_DELAY_MS`, `ORBIT_INTERACTION_DELAY_MS`
- Produces: `resolveCompassAction(currentBearing, designed): CompassAction`

- [x] **Step 1: Restore tests from `ba4b4e71^` and add capped-step expectations**

  Restore state-transition coverage for enable, interaction, reduced motion, suspend, dispose, 6 second first delay, and 20 second interaction delay. Add literal assertions that orbit step timers use `ORBIT_FRAME_INTERVAL_MS` and that derived step size never exceeds `ORBIT_MAX_BEARING_STEP_DEG`.

- [x] **Step 2: Run tests and verify RED**

  Run: `npm test -- __tests__/mapOrbit.test.ts __tests__/mapCompass.test.ts`

  Expected: FAIL because `@/lib/mapOrbit` and `@/lib/mapCompass` do not exist.

- [x] **Step 3: Restore helpers and implement timer-driven steps**

  `createIdleOrbit` must arm one idle timer, enter `orbiting`, call one step, then schedule the next step after `frameIntervalMs`. `noteInteraction`, `setEnabled(false)`, `setSuspended(true)`, reduced-motion checks, and `dispose` must clear every pending timer and call the stop callback when orbit is active.

- [x] **Step 4: Run focused tests and verify GREEN**

  Run: `npm test -- __tests__/mapOrbit.test.ts __tests__/mapCompass.test.ts`

  Expected: both files pass with no warning.

### Task 2: Integrate gated orbit and compass into current map canvas

**Files:**
- Modify: `components/PubMapCanvas.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: pure orbit constants and state machine from Task 1
- Consumes: `resolveCompassAction` from Task 1
- Produces: map bearing changes only after `pubmax:pin-reveal`, at capped interval and capped step

- [x] **Step 1: Add a failing integration fence at the narrowest practical seam**

  Extend orbit tests to prove interaction and suspend cancel a pending frame timer, including an interaction after first orbit starts. This catches a canvas integration that cannot stop timer-driven orbit immediately.

- [x] **Step 2: Run focused test and verify RED**

  Run: `npm test -- __tests__/mapOrbit.test.ts`

  Expected: FAIL because active frame timer remains or restarts after a gate closes.

- [x] **Step 3: Restore canvas wiring against current code**

  Import helpers and constants. Restore `mapBearing` and `orbitRef`. Track bearing on `moveend` and `rotateend`. Add effect keyed on `mapReady`; enable only from `pubmax:pin-reveal`; stop on pointer, wheel, touch, key, `pubmax:camera-intent`, and compass press; suspend on hidden tab and off-screen canvas. Each orbit step must call `jumpTo` with a bearing delta limited by `ORBIT_MAX_BEARING_STEP_DEG`, then schedule through pure orbit state machine.

- [x] **Step 4: Restore compass control and current-theme styling**

  Use `resolveCompassAction` to reset north from a rotated view or adopt city pitch and bearing from north. Use current neutral control tokens and 44 pixel phone tap target rules. Compass click must call `orbitRef.current?.noteInteraction()` before camera movement.

- [x] **Step 5: Run focused tests, lint, and type check**

  Run: `npm test -- __tests__/mapOrbit.test.ts __tests__/mapCompass.test.ts __tests__/mapChromeDebris.test.ts`

  Run: `npm run lint`

  Run: `npm run typecheck`

  Expected: all commands exit 0.

### Task 3: Document and prove shipped behavior

**Files:**
- Modify: `README.md:10`

**Interfaces:**
- Consumes: final phone decision from browser proof
- Produces: accurate product description and PR evidence

- [x] **Step 1: Update README**

  State that orbit begins only after idle readiness, stops on input, and uses capped steps. If phone flicker remains, state desktop-only behavior.

- [x] **Step 2: Browser-check desktop in dark and light themes**

  Run app with production output in `.next-prod`. At desktop width, record compass transform or map bearing before and after at least 10 idle seconds after pin reveal. Confirm bearing changes. Interact and confirm bearing stops immediately. Repeat dark and light.

- [x] **Step 3: Browser-check phone in dark and light themes**

  Emulate `390x844x3,mobile,touch`, reload in place, then repeat 10 second idle bearing check. Inspect screenshots and network/console activity for tile flicker or churn. If flicker persists, add desktop-width gate, update tests and README, and repeat desktop proof.

- [ ] **Step 4: Run final review and verification**

  Run focused tests, `npm run verify`, and isolated production build. Review full diff for stale comments, duplicate camera ownership, generated-file churn, and docs accuracy.

- [ ] **Step 5: Commit, push branch, and open PR**

  Commit normal code and docs only. Push `fm/map-orbit-restore`. Open PR against `main` with implementation, gate coverage, desktop proof, phone decision, both-theme proof, and verification results.
