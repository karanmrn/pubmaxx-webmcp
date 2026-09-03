import { expect, test, type Page } from "@playwright/test";

type CoreRoute = {
  name: string;
  path: string;
  ready: string;
  allowMapTeardownErrors?: boolean;
};

// One cheap contract for the shipped app spine. Feature-specific specs own the
// detailed interactions; this suite answers the more fundamental question:
// can every durable destination render from a clean, keyless production build?
const CORE_ROUTES: CoreRoute[] = [
  { name: "Today", path: "/today", ready: '[data-testid="today-screen"] h1' },
  { name: "Tonight", path: "/tonight", ready: '[data-testid="tonight-screen"] h1' },
  { name: "Explore map", path: "/map", ready: ".mapCanvasWrap", allowMapTeardownErrors: true },
  { name: "Plan", path: "/plan", ready: "main.planPage h1" },
  { name: "Moment", path: "/moment", ready: 'form[aria-label="Private Moment composer"]' },
  { name: "Social", path: "/social", ready: "h1.socialTitle" },
  { name: "You", path: "/u/you", ready: "#you-title" },
  { name: "Public profile", path: "/u/testdrinker", ready: "main.profileMain" },
];

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const route of CORE_ROUTES) {
  test(`${route.name} route renders its stable scaffold`, async ({ page }) => {
    const errors = watchPageErrors(page);
    const response = await page.goto(route.path);

    expect(response?.status(), `${route.path} status`).toBe(200);
    await expect(page.locator(route.ready).first(), `${route.path} ready marker`).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("nextjs-portal")).toHaveCount(0);

    // MapLibre can emit a harmless asynchronous getLayer teardown error on
    // GPU-less Chromium. The map-specific suites distinguish that condition
    // from real render failures; all deterministic routes remain page-error
    // clean here.
    if (!route.allowMapTeardownErrors) expect(errors, `${route.path} page errors`).toEqual([]);
  });
}
