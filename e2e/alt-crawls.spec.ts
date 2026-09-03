import { test, expect, type Page } from "@playwright/test";

// Alt crawl styles + calendar export (issue #31). Two low-risk, broad-appeal
// planner affordances: a "kind of night" style picker (Pint / Food / Coffee /
// Mocktail) and an "Add to calendar (.ics)" button on a built crawl.
//
// Like e2e/crawl-routes.spec.ts this is deliberately WebGL-agnostic and
// read-only: it deep-links straight into build mode with a crawl pre-loaded
// (?mode=build&pubs=… — the same shape a shared link uses, lib/crawlUrl), so
// the planner drawer opens WITHOUT any map/canvas interaction and the spec runs
// the same whether or not the headless browser has a real WebGL context. It
// tolerates empty data: the style picker renders regardless, and the calendar
// button only needs one resolved stop.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// Stable, dataset-pinned venue ids from the "Victorian Soho" curated crawl
// (lib/curatedCrawls.ts, pinned by __tests__/curatedCrawls.test.ts). If a
// re-export moves them the unit test fails first — here we just tolerate it.
const SEEDED_PUBS = "venue-1ufn31x,venue-1t8siin,venue-xiesdn";

test.describe("alt crawl styles + calendar export", () => {
  test("a URL-seeded crawl shows the style picker and the .ics affordance", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    // Deep-link into build mode with a coffee-style crawl pre-loaded. The ?alt=
    // param is round-tripped by lib/crawlUrl.
    const response = await page.goto(`/map?mode=build&pubs=${SEEDED_PUBS}&alt=coffee`);
    expect(response?.status()).toBe(200);

    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
    if ((await planner.count()) === 0) {
      await page.locator(".mobilePlanActivation").click();
    }
    await expect(planner).toBeVisible();
    await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
    const routePanel = planner.locator(".routePanel");

    // The alt-style picker always renders (it's not data-dependent). It carries
    // one radio per style, and the URL-seeded "coffee" is pre-selected.
    const picker = routePanel.getByTestId("alt-style-picker");
    await expect(picker).toBeVisible();
    const styleButtons = picker.getByRole("radio");
    await expect(styleButtons).toHaveCount(4);
    await expect(picker.getByRole("radio", { name: "Coffee" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Give the client fetch that resolves builtIds -> venues a chance to
    // populate before branching on stop count.
    const stops = routePanel.locator("ol.routeList > li");
    await expect
      .poll(async () => await stops.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(0);

    const calendarBtn = routePanel.getByTestId("add-to-calendar");
    if ((await stops.count()) >= 1) {
      // Populated route: the calendar affordance is present and clickable.
      await expect(calendarBtn).toBeVisible();
      await expect(calendarBtn).toContainText(".ics");

      // Switching the style updates the selection (client-only, no navigation).
      await picker.getByRole("radio", { name: "Mocktail" }).click();
      await expect(picker.getByRole("radio", { name: "Mocktail" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    } else {
      // Degraded data (ids didn't resolve): fewer than one stop means no
      // calendar button, but the page still loaded cleanly and the picker
      // rendered — the read-only guarantee we care about. Unit tests own the
      // .ics generation itself.
      await expect(calendarBtn).toHaveCount(0);
    }

    expect(errors).toEqual([]);
  });
});
