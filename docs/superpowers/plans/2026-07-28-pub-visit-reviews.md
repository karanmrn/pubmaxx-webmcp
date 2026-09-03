# Pub Visit Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing partial Visit Report substrate into the short, dated, contributor-attributed review lane that the contributor record can count.

**Architecture:** Keep `Visit Report` as the canonical domain term and extend its existing browser-safe validator, dual memory/Supabase store, route, and moderation queue. Replace recommendation proxies and aggregate summaries with individual newest-first visit accounts containing only plan-changing observations. Mount one shared composer and reader in the map venue sheet and existing venue pages, with explicit ready/degraded read status and an exact visible-report count by contributor.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase, Vitest, Playwright, existing CSS tokens.

## Global Constraints

- No star rating, score, average, or aggregate review verdict.
- Account text is capped at 140 characters in UI, validator, and database.
- Every report carries a venue, contributor handle, London visit date, server creation time, and at least one observed condition or short account.
- Observed conditions are crowd, noise, seating, and bar wait. Each can change whether a drinker visits now, later, or somewhere else.
- Public rows stay contributor claims, never verified venue facts.
- Reporting queues content for a moderator. Reporting never deletes or auto-hides it.
- Public reads distinguish an answered empty venue from a failed read.
- Hidden reports do not count toward contributor totals.
- No new dependency.
- New controls have 44px minimum tap targets and no motion unless `prefers-reduced-motion: no-preference`.
- Product copy follows `docs/VOICE.md`: British spelling, no em dash, no exclamation mark, no plumbing language.

---

### Task 1: Sharpen the Visit Report domain

**Files:**
- Modify: `CONTEXT.md`
- Modify: `lib/visitReports.ts`
- Modify: `__tests__/visitReports.test.ts`
- Delete: `lib/visitReportSummary.ts`
- Delete: `__tests__/visitReportSummary.test.ts`

**Interfaces:**
- Consumes: existing `VisitReport`, London evening date, handle normalisation, and slop-filter seams.
- Produces: `VisitReportFields` with `busyness`, `noise`, `seating`, `serviceWait`, and `note`; `VisitReportReadStatus`.

- [ ] **Step 1: Write failing domain tests**

```ts
it("accepts only plan-changing observed conditions", () => {
  const result = validateVisitReport({
    venueId: "v1",
    handle: "sam",
    visitedAt: "2026-07-20",
    busyness: "rammed",
    noise: "had-to-shout",
    seating: "standing",
    serviceWait: "long",
  }, NOW);
  expect(result).toMatchObject({
    ok: true,
    value: {
      busyness: "rammed",
      noise: "had-to-shout",
      seating: "standing",
      serviceWait: "long",
    },
  });
});

it("does not turn recommendation proxies into report fields", () => {
  const result = validateVisitReport({
    venueId: "v1",
    handle: "sam",
    wouldReturn: "yes",
    priceSanity: "fine",
  }, NOW);
  expect(result.ok).toBe(false);
});
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `npm test -- __tests__/visitReports.test.ts`

Expected: failure because `noise`, `seating`, and `serviceWait` do not exist and legacy recommendation fields still satisfy validation.

- [ ] **Step 3: Implement the focused domain contract**

Define closed vocabularies:

```ts
export const NOISE_VALUES = ["easy-to-talk", "loud", "had-to-shout"] as const;
export const SEATING_VALUES = ["plenty", "tight", "standing"] as const;
export const SERVICE_WAIT_VALUES = ["quick", "some-wait", "long"] as const;
```

Keep the existing `MAX_VISIT_NOTE = 140`, London evening date, handle normalisation, moderation DTO stripping, and shared validation. Remove `wouldReturn` and `priceSanity` from the public domain shape and delete aggregate summary code.

- [ ] **Step 4: Record canonical language**

Rewrite the `Visit Report` glossary entry to define a short contributor account anchored to a dated visit and observed conditions. State that it is never a rating or verified venue fact.

- [ ] **Step 5: Run domain tests and verify GREEN**

Run: `npm test -- __tests__/visitReports.test.ts`

Expected: pass.

---

### Task 2: Make storage, moderation, and counting honest

**Files:**
- Modify: `lib/visitReportsStore.ts`
- Modify: `__tests__/visitReportsStore.test.ts`
- Create: `supabase/migrations/20260728120000_0058_visit_report_review_lane.sql`
- Create: `__tests__/visitReportsReviewLaneMigration.test.ts`

**Interfaces:**
- Consumes: Task 1 `VisitReportFields` and `VisitReportDTO`.
- Produces: `readForVenue(venueId): Promise<{status, reports}>`, `countForContributor(handle): Promise<{status, count}>`, reported moderation queue, and moderator hide/restore.

- [ ] **Step 1: Write failing store tests**

```ts
it("queues a flag without letting a reader erase the report", async () => {
  const report = await memoryVisitReportStore.create(fields());
  await memoryVisitReportStore.report(report.id, "abuse", "actor-a");
  expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
  expect((await memoryVisitReportStore.listForReview()).map((row) => row.id)).toContain(report.id);
});

it("counts only visible reports for one contributor", async () => {
  const visible = await memoryVisitReportStore.create(fields({ visitedAt: "2026-07-20" }));
  const hidden = await memoryVisitReportStore.create(fields({ visitedAt: "2026-07-21" }));
  await memoryVisitReportStore.moderate(hidden.id, "hidden", "abuse");
  expect(await memoryVisitReportStore.countForContributor("SAM")).toEqual({
    status: "ready",
    count: 1,
  });
  expect(visible.id).not.toBe(hidden.id);
});
```

- [ ] **Step 2: Run store tests and verify RED**

Run: `npm test -- __tests__/visitReportsStore.test.ts`

Expected: failure because current reports auto-hide at a threshold, reads cannot report degraded status, and contributor counts do not exist.

- [ ] **Step 3: Implement memory and Supabase contracts**

Make public flagging append one server-derived actor once and leave `status` unchanged. `listForReview()` returns rows with `report_count > 0` that have no moderation decision. `moderate(id, "hidden" | "visible")` is the only visibility transition. `readForVenue` returns newest-first visible rows and `ready` or `degraded`. `countForContributor` normalises the handle, counts visible rows exactly, and returns read status.

- [ ] **Step 4: Add additive database migration**

Add `noise`, `seating`, and `service_wait` nullable columns with closed `CHECK` constraints. Add `(handle, status)` count index. Keep legacy `would_return` and `price_sanity` columns nullable for stored-row compatibility but stop writing and reading them in application code.

- [ ] **Step 5: Add migration behaviour tests**

Assert the migration adds each new constrained column, preserves RLS/service-role-only access, adds the count index, and does not drop the table or legacy data columns.

- [ ] **Step 6: Run store and migration tests and verify GREEN**

Run: `npm test -- __tests__/visitReportsStore.test.ts __tests__/visitReportsReviewLaneMigration.test.ts`

Expected: pass.

---

### Task 3: Expose individual reads, flags, moderation, and counts

**Files:**
- Modify: `app/api/visit-reports/route.ts`
- Modify: `components/visits/visitReportsClient.ts`
- Modify: `__tests__/visitReportsRoute.test.ts`

**Interfaces:**
- Consumes: Task 2 store result shapes.
- Produces:
  - `GET ?venueId=...` to `{status, reports}`
  - `GET ?contributor=...` to `{contributor, count, status}`
  - public `POST {action:"report", id, reason?}`
  - moderator `POST {action:"hide"|"restore", id, note?}`

- [ ] **Step 1: Write failing route tests**

```ts
it("returns newest-first individual reports and read status", async () => {
  await memoryVisitReportStore.create(fields({ visitedAt: "2026-07-19" }), 1);
  await memoryVisitReportStore.create(fields({ visitedAt: "2026-07-20" }), 2);
  const response = await GET(getRequest("?venueId=venue-1"));
  const body = await response.json();
  expect(body.status).toBe("ready");
  expect(body.reports.map((row: { visitedAt: string }) => row.visitedAt))
    .toEqual(["2026-07-20", "2026-07-19"]);
  expect(body.summary).toBeUndefined();
});

it("exposes the visible count a leaderboard can read", async () => {
  await memoryVisitReportStore.create(fields());
  const response = await GET(getRequest("?contributor=SAM"));
  expect(await response.json()).toEqual({
    contributor: "sam",
    count: 1,
    status: "ready",
  });
});
```

- [ ] **Step 2: Run route tests and verify RED**

Run: `npm test -- __tests__/visitReportsRoute.test.ts`

Expected: failure because current GET returns an aggregate summary and has no contributor branch.

- [ ] **Step 3: Implement route and client**

Remove summary production and return individual reports with status. Derive flag identity only from `hashActor("visit-report:" + hashIp(clientIp(request)))`; never accept an actor token from the body. Add count branch before venue validation. Change moderator actions to `hide` and `restore`. Update client fetch/post types and add `reportVisitReport`.

- [ ] **Step 4: Run route tests and verify GREEN**

Run: `npm test -- __tests__/visitReportsRoute.test.ts`

Expected: pass.

---

### Task 4: Ship the one-handed venue composer and newest-first reader

**Files:**
- Modify: `components/visits/VisitReportPanel.tsx`
- Modify: `components/visits/visitReports.css`
- Modify: `components/map/inspector/VenueStoryTab.tsx`
- Modify: `app/ledger/[id]/page.tsx`
- Modify: `app/bar-tab/[id]/page.tsx`
- Modify: `app/admin/AdminClient.tsx`
- Create: `__tests__/visitReportSurface.test.ts`
- Modify: `e2e/social-loop.spec.ts`

**Interfaces:**
- Consumes: Task 3 client.
- Produces: one shared composer and individual reader on all venue surfaces, including map sheet.

- [ ] **Step 1: Write failing surface contract tests**

The source-level UI contract test reads the shipped component and CSS to catch these concrete regressions:

```ts
expect(panel).toContain('type="date"');
expect(panel).toContain("MAX_VISIT_NOTE");
expect(panel).toContain("read.reports");
expect(panel).toContain("reportVisitReport");
expect(panel).not.toContain("VisitReportSummary");
expect(css).toMatch(/min-height:\\s*44px/);
expect(storyTab).toContain("<VisitReportPanel");
```

- [ ] **Step 2: Run surface test and verify RED**

Run: `npm test -- __tests__/visitReportSurface.test.ts`

Expected: failure because the map venue sheet does not mount the panel, the composer hides the visit date, rows are not rendered, and controls are under 44px.

- [ ] **Step 3: Implement the reader**

Render each `VisitReportDTO` as an article in API order with `@handle`, formatted visit day, optional 140-character account, and selected observation labels. Include a quiet `Report` button. When read status is `ready` with zero rows, say `No visits have been written up here yet.` When status is `degraded` with zero rows, say `We couldn't check the visit notes here just now.` Never render a score, average, star, or aggregate count.

- [ ] **Step 4: Implement the composer**

Use one visible date input defaulted to the current London evening. Render four labelled chip groups with three 44px options each, one 140-character textarea with a live remaining count, the existing contributor handle input, and one full-width submit button. Placeholder: `What did you find when you walked in?` Submit the explicit date and selected observations. Do not auto-open it on page load.

- [ ] **Step 5: Mount one shared component**

Mount `VisitReportPanel` on `VenueStoryTab` for the map sheet. Keep the same shared component on ledger and bar-tab pages, removing duplicate venue rating panels from those pages so a visit account is not presented beside a competing pub score.

- [ ] **Step 6: Update moderation UI**

Load `?status=reported`, display new observed fields, and offer `Hide` or `Keep visible`. Both actions clear the report from the pending queue after the moderator decision.

- [ ] **Step 7: Add 390px browser journey**

Add a keyless Playwright case that sets a 390x844 viewport, opens a known venue, reaches its Story tab, opens the composer, selects date and observed fields, enters a unique short account and handle, submits, and asserts the same account returns as the first visit row with no star or score controls.

- [ ] **Step 8: Run focused tests and E2E**

Run:

```bash
npm test -- __tests__/visitReportSurface.test.ts __tests__/visitReports.test.ts __tests__/visitReportsStore.test.ts __tests__/visitReportsRoute.test.ts
PW_PORT=3128 npx playwright test e2e/social-loop.spec.ts --project=chromium --grep "visit report"
```

Expected: pass.

---

### Task 5: Document, verify, and prepare PR evidence

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/WRITE_SURFACE_CERTIFICATION.md` only if route contract wording is stale
- Create: `docs/evidence/pub-visit-reviews/README.md`
- Create: `docs/evidence/pub-visit-reviews/visit-report-390x844.png`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: durable owner note, browser evidence, green gate, committed branch, and PR-ready reasoning.

- [ ] **Step 1: Record durable owner contract**

Add one concise `AGENTS.md` entry pointing to `lib/visitReports.ts`, the no-score individual-read rule, moderator-only removal, read status, and contributor count seam.

- [ ] **Step 2: Run focused quality gates**

Run:

```bash
npm test -- __tests__/visitReports.test.ts __tests__/visitReportsStore.test.ts __tests__/visitReportsRoute.test.ts __tests__/visitReportsReviewLaneMigration.test.ts __tests__/visitReportSurface.test.ts
npm run lint
npm run typecheck
git diff --check
```

Expected: all pass with no warnings caused by this change.

- [ ] **Step 3: Verify in real Chrome at 390x844**

Start keyless dev server, open `/map`, apply the required 390x844x3 mobile/touch emulation, reload in place, write and read a report, inspect dark mode, keyboard reach, tap targets, overflow, and reduced motion. Capture `visit-report-390x844.png`.

- [ ] **Step 4: Run full gate**

Run: `npm run verify`

Expected: green.

- [ ] **Step 5: Review and commit**

Use the required review and verification playbooks. Confirm diff contains only Visit Report lane work and generated local churn is restored. Commit with:

```bash
git add CONTEXT.md AGENTS.md app components lib supabase/migrations __tests__ e2e docs
git commit -m "feat(venues): build visit report review lane"
```

- [ ] **Step 6: Prepare PR body content**

State:

- Why canonical object is `Visit Report`, not a star review.
- Why crowd, noise, seating, and bar wait each change a plan.
- Why 140 characters is the format boundary.
- Why the venue read shows contributor claims and visit dates, never verified facts.
- How `GET /api/visit-reports?contributor=<handle>` exposes the visible count.
- Why the venue lane sorts on `visitedAt` (with `createdAt` as the deterministic tie-break): a row prints the visit date alone, so ordering on submission time would read as out of order.
- The 90-calendar-day bound on `visitedAt` and why it exists: sorting on the visited date makes it authority-bearing, so an unbounded past date would hand one submission the top of a pub's page indefinitely, and a night from years ago describes a room that may no longer exist. Both ends are inclusive (today and exactly 90 days ago are in, tomorrow and 91 days ago are out), it is enforced server-side in `resolveVisitedAt`, and the composer's `min`/`max` only mirror it.
- V1 moderation gap: one owner queue, reactive flags, no appeals, notifications, or proactive text triage. Hide and restore are both reachable from `/admin` — hidden rows keep their own lane (`GET ?status=hidden`) so a decision is reversible without hand-posting an id.
- Exact 390px screenshot path and verification commands.
