import { test, expect } from "@playwright/test";

// Quality-floor + security-seam E2E (PRD "Testing Decisions" — public pages under
// CSP; owner-only profile edit rejected for non-owners; POI + non-alcoholic
// filters flip visible UI state). Two shapes live here:
//
//   1. Request-level (Playwright `request` fixture) assertions on the profile
//      write seam — no browser, just the HTTP contract of
//      app/api/profiles/[handle] (PATCH/PUT). These are hermetic: they never
//      depend on a rendered page.
//   2. Browser assertions on the four public read surfaces' CSP header, and on
//      the two map filter toggles the user can actually flip without touching the
//      WebGL canvas (the non-alcoholic filter in the planner's control rail; the
//      POI category toggles, which are canvas-adjacent overlays and so guarded).
//
// House style (e2e/social-loop.spec.ts): read-only, `.count()`-guarded for
// empty-vs-populated, WebGL-agnostic (never asserts canvas pixels), web-first
// assertions, no waitForTimeout. Where a surface is genuinely unreachable
// headlessly we skip-with-reason rather than write a flaky test.

// A raw internal venue id ("venue-16pnwmm"): the PRD's honesty guard forbids it
// leaking as visible text. Re-pinned here on the map surface we exercise.
const RAW_VENUE_ID = /venue-[a-z0-9]+/;

// ---------------------------------------------------------------------------
// Owner-only profile edit — request-level (PRD user story 31).
//
// The write seam (app/api/profiles/[handle]/route.ts) gates ownership at the API
// boundary (writes go through the service-role client, so RLS alone can't gate
// them — see lib/profileOwnership.ts + migration 0009). The ownership DECISION
// itself is pure and exhaustively unit-tested (lib/profileOwnership.ts via
// __tests__/profileOwnership*.test.ts): an UNLINKED handle stays editable by
// anyone (the demo/self-asserted-handle stance); a LINKED handle is editable
// ONLY by its matching authenticated owner (a non-owner → 403).
//
// At the HTTP seam, headlessly, we can only ever synthesise a NON-owner caller
// (no Authorization, or a garbage bearer). Whether that call is rejected (403)
// or allowed (200) then depends on backend state we can't deterministically
// fabricate here: on a store-backed env an UNLINKED target legitimately 200s
// (demo path — that is correct, not a hole), while a LINKED target 403s; on a
// store-less prod env every write 503s. Asserting a fixed status for an
// arbitrary handle would therefore be coupling to environment state, not to the
// contract. So these request-level tests pin the parts of the contract that hold
// in EVERY backend and never depend on which handle is linked:
//
//   • The trust boundary runs FIRST: a malformed body is a clean 400, and a
//     missing handle is rejected up front — before any ownership/store branch.
//   • The write path NEVER crashes (never 5xx-except-the-documented-503) and
//     never returns an unexpected status: it resolves to a known, documented
//     code for a non-owner caller.
//   • PUT is a true alias for PATCH (identical status for the identical call).
//
// The positive "LINKED handle → 403 for a non-owner, 200 for the owner" pair is
// left to the pure unit test (no DB/JWT needed there), which is the honest place
// to assert it deterministically. Read-only: these writes are refused by the
// trust boundary or by ownership before mutating anything real.

// Documented statuses the profile write seam can return for a non-owner caller
// with a well-formed body: 200 (demo/unlinked, store present), 403 (linked,
// not-owner), 401 (rejected auth), 429 (rate-limited), 503 (no store in prod).
// Anything OUTSIDE this set — a 500, a 302, a 404-on-a-real-handle — is a bug.
const DOCUMENTED_WRITE_STATUSES = new Set([200, 401, 403, 429, 503]);

test.describe("profile edit seam — request-level trust boundary (story 31)", () => {
  // We only ever attempt writes as a NON-owner (no session). A same-named real
  // account is never mutated: an unlinked handle is the demo path (a throwaway
  // field patch), a linked one rejects us. We use a nonce handle so we never
  // even collide with a meaningful profile.
  const TARGET = `e2e-nonowner-${Date.now().toString(36)}`;

  test("a malformed body is a clean 400, never a 500 (trust boundary runs first)", async ({
    request,
  }) => {
    const res = await request.patch(`/api/profiles/${TARGET}`, {
      headers: { "content-type": "application/json" },
      data: "this is not json at all {",
    });
    // Body-parse validation precedes the ownership/store branch, so this is
    // deterministically a 400 in every backend.
    expect(res.status()).toBe(400);
  });

  test("a garbage bearer token never yields an unexpected status (no 500 crash)", async ({
    request,
  }) => {
    const res = await request.patch(`/api/profiles/${TARGET}`, {
      headers: { Authorization: "Bearer not-a-real-jwt.deadbeef.forged" },
      data: { displayName: "Forged" },
    });
    // A forged token resolves the caller to anonymous (never a trusted uid) — the
    // seam must handle it as a documented outcome, never crash on it.
    expect(
      DOCUMENTED_WRITE_STATUSES.has(res.status()),
      `forged-token PATCH returned an undocumented status ${res.status()}`,
    ).toBeTruthy();
  });

  test("PUT is a true alias for PATCH (identical status for the identical call)", async ({
    request,
  }) => {
    const body = { bio: "alias-check" };
    const [patchRes, putRes] = await Promise.all([
      request.patch(`/api/profiles/${TARGET}-a`, { data: body }),
      request.put(`/api/profiles/${TARGET}-a`, { data: body }),
    ]);
    // Both must be documented outcomes…
    expect(DOCUMENTED_WRITE_STATUSES.has(patchRes.status())).toBeTruthy();
    expect(DOCUMENTED_WRITE_STATUSES.has(putRes.status())).toBeTruthy();
    // …and PUT mirrors PATCH's contract (aside from a possible rate-limit on the
    // second identical write in the same window, which is itself documented).
    if (patchRes.status() !== 429 && putRes.status() !== 429) {
      expect(putRes.status()).toBe(patchRes.status());
    }
  });

  test("an empty handle is rejected up front, never a silent 200", async ({ request }) => {
    // A whitespace-only handle normalises to empty → 400 before any store touch
    // (some routers 404 the empty segment before the handler — both are non-200).
    const res = await request.patch(`/api/profiles/${encodeURIComponent("   ")}`, {
      data: { displayName: "x" },
    });
    expect([400, 404]).toContain(res.status());
    expect(res.status()).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Public pages render under a Content-Security-Policy (PRD Quality floor +
// governance). The header is set for `/:path*` in next.config.mjs, so every
// public read surface must carry it. We assert the three canonical directives
// that make the policy meaningful (a bare "CSP: ;" would pass a mere presence
// check but not this). Read-only bare GETs.
for (const path of ["/", "/map", "/feed", "/discover"]) {
  test(`quality floor: ${path} responds with a real Content-Security-Policy header`, async ({
    request,
  }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);

    const headers = res.headers();
    const csp = headers["content-security-policy"];
    expect(csp, `${path} must set a Content-Security-Policy header`).toBeTruthy();

    // The policy is substantive, not an empty stub: it locks the origin, forbids
    // being framed, and denies plugin/object embedding (matches next.config.mjs).
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
}

// ---------------------------------------------------------------------------
// Non-alcoholic filter toggle — flips a real control inside the one coordinated
// planner sheet. This is WebGL-agnostic and never writes location or voice data.
test("quality floor: the non-alcoholic filter checkbox flips its checked state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // PubMap is a client component — wait for the map region to mount (proof it
  // hydrated) before driving the toolbar. WebGL-agnostic: canvas OR fallback.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".maplibreMap, .mapFallback").first()).toBeVisible();

  // Open the planner so the control rail's filter toggles become visible.
  const planBtn = page.getByRole("button", { name: "Describe the outing" });
  await expect(planBtn).toBeVisible();
  await planBtn.click();
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  await expect(planner).toBeVisible();
  await planner.getByRole("button", { name: "Expand sheet" }).click();
  await expect(planner.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);

  // The control rail is now revealed; find the "Non-alcoholic" filter checkbox
  // by its label text (components/map/ControlRail.tsx wraps the input in a
  // <label> reading "Non-alcoholic"). It defaults to off.
  const nonAlc = planner
    .locator(".controlRail label", { hasText: "Non-alcoholic" })
    .locator('input[type="checkbox"]');
  await expect(nonAlc).toHaveCount(1);
  await expect(nonAlc).toBeVisible();
  await expect(nonAlc).not.toBeChecked();

  // Flipping it must move the visible checked state — the user-facing contract.
  await nonAlc.check();
  await expect(nonAlc).toBeChecked();

  // …and it toggles back off (idempotent, no stuck state).
  await nonAlc.uncheck();
  await expect(nonAlc).not.toBeChecked();
});

// ---------------------------------------------------------------------------
// POI category toggles live in the coordinated Layers sheet and remain usable
// even when the basemap falls back.
test("quality floor: a POI category toggle flips in the coordinated Layers sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });

  const layersFab = page.getByRole("button", { name: "More map controls" });
  await expect(layersFab).toBeVisible();
  await layersFab.click();

  const layers = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
  await expect(layers).toBeVisible();
  await layers.getByRole("tab", { name: "Layers" }).click();

  const poiGroup = layers.getByRole("group", { name: "Points of interest" });
  await expect(poiGroup).toBeVisible();

  const firstToggle = poiGroup.locator("button.mapLayersChip").first();
  await expect(firstToggle).toBeVisible();

  const before = await firstToggle.getAttribute("aria-pressed");
  expect(before === "true" || before === "false").toBe(true);
  await firstToggle.click();
  await expect(firstToggle).toHaveAttribute(
    "aria-pressed",
    before === "true" ? "false" : "true",
  );
  await firstToggle.click();
  await expect(firstToggle).toHaveAttribute("aria-pressed", before ?? "true");

  const groupText = (await poiGroup.innerText()).trim();
  expect(groupText).not.toMatch(RAW_VENUE_ID);
});
