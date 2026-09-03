# Mobile Map Pins First-Impression Investigation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure cold-load pub-pin visibility on phone and desktop, identify whether the reported empty map is late rendering, filter suppression, or a mid-load capture, and preserve phone motion evidence.

**Architecture:** A disposable Playwright harness will observe browser paint timings, the app's `pubmax:pin-reveal` event, loading chrome, URL and storage filter state, and real canvas frames. Product code stays unchanged unless this real-browser loop proves an empty-and-settled state. Banner stacking is inspected only after the pin verdict.

**Tech Stack:** Next.js 16 production build, Playwright Chromium with SwiftShader, browser Paint Timing API, MP4 or ordered PNG evidence, Vitest for any regression contract.

## Global Constraints

- Measure 390 by 844 and 1440 by 900 from runs performed in this worktree.
- Do not touch phone control rows, Filters overflow, row alignment, pin colours, price bands, or map key.
- Do not refactor `components/PubMap.tsx` or `components/PubMapCanvas.tsx`.
- Do not invent a fix when pins render promptly and loading state is honest.
- Save cold-load motion evidence under `docs/evidence/mobile-map-pins/`.
- Commit each coherent piece.

---

### Task 1: Build the real-browser feedback loop

**Files:**
- Create: disposable Playwright harness outside the repository
- Create: `docs/evidence/mobile-map-pins/` captures

**Interfaces:**
- Consumes: `pubmax:pin-reveal`, `.mapLoading`, `.maplibreMap canvas`, browser Paint Timing entries.
- Produces: measured first-paint-to-pin-reveal durations, loading-state observations, URL and storage state, phone frames or video.

- [ ] **Step 1: Build and serve the current commit from an isolated Next output directory**

Run:

```bash
NEXT_DIST_DIR=.next-fm-map-pins npm run build
NEXT_DIST_DIR=.next-fm-map-pins npm start -- --port 3317
```

Expected: `/map` returns 200 from the current commit without using another lane's server.

- [ ] **Step 2: Run cold mobile and desktop samples**

Launch fresh Chromium contexts with SwiftShader, no service worker, empty cache, a 390 by 844 or 1440 by 900 viewport, and the onboarding keys set. Before navigation, register timestamps for `first-paint`, `first-contentful-paint`, loading-chrome removal, and `pubmax:pin-reveal`.

Expected: each sample records only events observed during that run. At least three samples per viewport establish whether the result is stable.

- [ ] **Step 3: Assert on the exact reported symptom**

At pin reveal, capture the map viewport and verify the app's loading status is absent. Before reveal, capture frames at short intervals and verify either honest loading chrome remains visible or the reported empty-and-settled map appears.

Expected red condition: `.mapLoading` is absent for a material interval before pub pins or clusters reveal.

- [ ] **Step 4: Record filter and banner state**

Record final URL, local storage map preferences, visible pub or cluster layers through the app event, and visible dismissible banner headlines at phone width.

Expected: evidence separates filter suppression from delayed reveal and shows whether banners stack.

---

### Task 2: Apply only an evidence-backed change

**Files:**
- Test, modify, and create files only after Task 1 identifies the owning seam.

**Interfaces:**
- Consumes: Task 1's reproducible red condition.
- Produces: smallest test-first fix, or an explicit no-product-change verdict.

- [ ] **Step 1: Choose the evidence-backed path**

If pins reveal promptly and loading chrome covers every pre-reveal frame, make no product-code change. If an empty-and-settled interval exists, write a failing regression at its narrowest real seam before implementation. If persisted filters suppress all content, test the missing disclosure before adding it.

- [ ] **Step 2: Verify the failing test when a change is required**

Run the focused Vitest or Playwright command naming the new regression.

Expected: failure states the observed empty-and-settled or undisclosed-filter behavior, not a source-text implementation detail.

- [ ] **Step 3: Implement the minimum fix when required**

Keep ownership outside phone control-row files. Preserve truthful loading semantics and existing pin styles.

- [ ] **Step 4: Re-run the focused regression**

Expected: focused test passes with no warnings or unrelated failures.

---

### Task 3: Preserve and verify evidence

**Files:**
- Create: `docs/evidence/mobile-map-pins/README.md`
- Create: `docs/evidence/mobile-map-pins/mobile-cold-load.webm` or an ordered phone frame sequence

**Interfaces:**
- Consumes: final cold-load run from the current branch.
- Produces: reviewable motion evidence and exact timing method.

- [ ] **Step 1: Capture final phone journey**

Use Playwright's viewport video or ordered screenshots from navigation start through loading chrome and pin reveal. Keep native 390 by 844 framing.

- [ ] **Step 2: Verify artifact**

Run:

```bash
ls -la docs/evidence/mobile-map-pins
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate -show_entries format=duration,size -of json docs/evidence/mobile-map-pins/mobile-cold-load.webm
```

Expected: non-empty browser-only recording with phone dimensions and duration extending past pin reveal.

- [ ] **Step 3: Document method and verdict**

Write only measured timings. State first-paint definition, pin-visible signal, sample count, viewport, cold-context method, loading-chrome behavior, filter state, banner result, and verdict.

---

### Task 4: Closeout

**Files:**
- Modify only files created or changed by Tasks 2 and 3.

**Interfaces:**
- Consumes: final branch and evidence.
- Produces: verified commits and complexity delta.

- [ ] **Step 1: Run focused tests and proportional project checks**

Run the new focused regression if any, relevant existing map tests, lint on changed source, typecheck, and evidence verification.

- [ ] **Step 2: Inspect diff and generated-file churn**

Restore local `next-env.d.ts` development churn if present. Confirm no phone control-row files changed and report line-count or complexity delta for `PubMap` and `PubMapCanvas`.

- [ ] **Step 3: Commit coherent output**

Commit diagnosis evidence separately from any product fix. Report the exact verdict and every measured timing.
