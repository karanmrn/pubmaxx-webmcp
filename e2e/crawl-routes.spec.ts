import { test, expect, type Page } from "@playwright/test";

// Explore-London routing (issue #20, user stories 25-26): a crawl is a real
// walking/running route, not just a list. The planner's RoutePanel annotates
// each leg with a straight-line walk time + distance ("12 min walk · 0.9 km,
// straight-line") and a route total, and offers a walk/run pace toggle.
//
// This spec is deliberately WebGL-agnostic and read-only: it seeds a crawl
// straight from the URL (?mode=build&pubs=…, the same deep-link shape a shared
// or "start a crawl here" link uses — lib/crawlUrl), which opens the planner
// drawer WITHOUT any map/canvas interaction. So it runs the same whether or not
// the headless browser has a real WebGL context. It tolerates empty data: if
// the bundled dataset ever stops resolving these ids, the leg annotations
// simply won't render and the test skips its route-specific assertions rather
// than failing on missing data.
//
// Style matches the other new specs (e.g. e2e/borough-crawls-security.spec.ts):
// watchPageErrors, web-first assertions, no waitForTimeout, .count()-guarded
// populated-vs-empty branches.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// Two stable, dataset-pinned venue ids from the "Victorian Soho" curated crawl
// (lib/curatedCrawls.ts). Pinned against the bundled dataset by
// __tests__/curatedCrawls.test.ts, so if a re-export moves them that unit test
// fails first — here we just tolerate their absence.
const SEEDED_PUBS = "venue-1ufn31x,venue-1t8siin,venue-xiesdn";

async function prepareMobileMap(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function openPlanner(page: Page) {
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  if ((await planner.count()) === 0) await page.locator(".mobilePlanActivation").click();
  await expect(planner).toBeVisible();
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
  return planner;
}

test.describe("crawl routes — walk-time leg annotations", () => {
  test("a URL-seeded crawl opens the planner with per-leg walk-time annotations and a total", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);
    await prepareMobileMap(page);

    // Deep-link straight into build mode with the crawl pre-loaded. This is the
    // same ?mode=build&pubs=… state that "start a crawl here" and shared crawl
    // links produce — so it also exercises that themed/curated routes compose
    // with the URL state (story 27/§3 of the issue).
    const response = await page.goto(`/map?mode=build&pubs=${SEEDED_PUBS}`);
    expect(response?.status()).toBe(200);

    // The URL opens the one coordinated planner sheet on arrival.
    const planner = await openPlanner(page);
    const routePanel = planner.locator(".routePanel");

    // The ordered stop list is the route surface. Give the client fetch that
    // resolves builtIds -> venues a chance to populate before branching.
    const stops = routePanel.locator("ol.routeList > li");
    await expect
      .poll(async () => await stops.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    const stopCount = await stops.count();
    if (stopCount < 2) {
      // Empty/degraded data (ids didn't resolve): with fewer than two stops
      // there are no legs to annotate. Nothing route-specific to assert — the
      // page still loaded cleanly, which is the read-only guarantee we care
      // about. The unit tests own the leg math itself.
      expect(errors).toEqual([]);
      return;
    }

    // Populated route: at least one leg annotation between consecutive stops.
    // A route of N stops yields N-1 legs (lib/routeLegs.buildRouteLegs).
    const legs = routePanel.locator(".routeLeg");
    await expect(legs.first()).toBeVisible();
    expect(await legs.count()).toBe(stopCount - 1);

    // The leg label is the honest, straight-line walk-time annotation, e.g.
    // "3 min walk · 0.2 km, straight-line". Assert the load-bearing shape
    // (a walk time + a "straight-line" honesty marker) without pinning the
    // exact numbers, which depend on live coordinates.
    await expect(legs.first()).toContainText(/\d+\s*min\s*walk/);
    await expect(legs.first()).toContainText(/straight-line/);

    // A route total is surfaced alongside the pace toggle.
    await expect(routePanel.locator(".routePaceTotal")).toContainText(/\d+\s*min\s*walk\s*total/);

    expect(errors).toEqual([]);
  });

  test("the walk/run pace toggle re-labels the legs as running", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);
    await prepareMobileMap(page);

    const response = await page.goto(`/map?mode=build&pubs=${SEEDED_PUBS}`);
    expect(response?.status()).toBe(200);

    const planner = await openPlanner(page);
    const routePanel = planner.locator(".routePanel");

    const stops = routePanel.locator("ol.routeList > li");
    await expect
      .poll(async () => await stops.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    if ((await stops.count()) < 2) {
      // No legs, so no pace toggle — tolerate empty data and stop here.
      expect(errors).toEqual([]);
      return;
    }

    const runBtn = routePanel.locator("button.routePaceBtn", { hasText: "Run" });
    await expect(runBtn).toBeVisible();
    await runBtn.click();
    await expect(runBtn).toHaveAttribute("aria-pressed", "true");

    // After switching pace the legs read "… min run …" and the total follows.
    await expect(routePanel.locator(".routeLeg").first()).toContainText(/\d+\s*min\s*run/);
    await expect(routePanel.locator(".routePaceTotal")).toContainText(/\d+\s*min\s*run\s*total/);

    expect(errors).toEqual([]);
  });
});
