# Vercel Postcode CI Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make postcode-coordinate regression coverage pass in Vercel without weakening rebuild or quarantine guarantees.

**Architecture:** Keep postcode decisions in existing Node resolver and remove undeclared `pandas` dependency from Python dataset assembler by expressing existing CSV grouping, sorting, correction, quarantine, and summary operations with Python standard library. Keep published leak matching at measured serialization tolerance and align integration fixture with that contract.

**Tech Stack:** Python 3 standard library, Node.js 22, TypeScript, Vitest.

## Global Constraints

- Preserve raw source evidence.
- Keep 5 km contradiction threshold.
- Quarantine must remain exact at build time and rebuild-durable.
- Published leak validation may tolerate only 0.0000001 degrees of coordinate serialization drift.
- Make smallest root-cause fix and run relevant local verification.

---

### Task 1: Make Dataset Builder Portable

**Files:**
- Modify: `__tests__/buildAppDatasetQuarantine.test.ts`
- Modify: `scripts/build_app_dataset.py`

**Interfaces:**
- Consumes: Existing source CSVs and `scripts/resolve_postcode_coordinate_decisions.mjs`.
- Produces: Same `data/pint_prices_app_dataset.csv`, `data/postcode_coordinate_build_report.json`, console quarantine lines, and summary fields without third-party Python packages.

- [x] **Step 1: Make integration test run Python without site packages**

Change builder invocation to `python3 -S` so an undeclared package import is caught deterministically.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/buildAppDatasetQuarantine.test.ts`

Expected: FAIL with `ModuleNotFoundError: No module named 'pandas'`.

- [x] **Step 3: Replace dataframe operations with standard-library CSV operations**

Use `csv.DictReader`, ordered dictionaries, normal list filtering, deterministic sort keys, and `csv.DictWriter`. Preserve field order, values, correction application, quarantine output, file fingerprints, and summary counts.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/buildAppDatasetQuarantine.test.ts`

Expected: 2 tests pass with `python3 -S`.

### Task 2: Align Published Leak Integration Fixture

**Files:**
- Modify: `__tests__/validateDrinkPriceUpdatesScript.test.ts`

**Interfaces:**
- Consumes: `POSTCODE_COORDINATE_PUBLISHED_LEAK_TOLERANCE_DEGREES` contract.
- Produces: End-to-end validation proof for reassigned IDs and expanded addresses at serialization-scale coordinate drift.

- [x] **Step 1: Correct fixture drift**

Change injected latitude and longitude drift from `0.000005` degrees to `0.00000005` degrees, matching existing focused regression coverage and remaining within measured tolerance.

- [x] **Step 2: Run focused test**

Run: `npm test -- __tests__/validateDrinkPriceUpdatesScript.test.ts -t "quarantined identity leaks under a reassigned id"`

Expected: 1 test passes.

### Task 3: Verify CI Contract

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: Fresh evidence that targeted regressions and full Vercel command pass.

- [x] **Step 1: Run postcode regression files**

Run: `npm test -- __tests__/buildAppDatasetQuarantine.test.ts __tests__/validateDrinkPriceUpdatesScript.test.ts __tests__/postcodeCoordinateDecisionRegistries.test.ts __tests__/postcodeCoordinateConsistency.test.ts`

Expected: all tests pass.

- [x] **Step 2: Run Vercel build command**

Run: `NEXT_DIST_DIR=.next-prod npm run ci`

Expected: validation, lint, typecheck, coverage, audit, and build exit 0.

- [x] **Step 3: Inspect worktree**

Run: `git diff --check && git status --short`

Expected: only intentional CI fix files and this required plan are changed; no generated tooling churn.
