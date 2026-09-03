import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "first-run tour should not horizontally overflow").toBeLessThanOrEqual(1);
}

test.describe("mobile first-run tour", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmax-tour-v1-done");
      window.localStorage.removeItem("pubmax-tour-v2-done");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("presents thumb-safe onboarding controls before first value", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Map-only gate (lib/firstRunTour.ts); /pubs is a gallery, not the map.
    await page.goto("/map");

    const tour = page.getByRole("dialog", { name: "Pint price colours" });
    await expect(tour).toBeVisible();
    await expect(tour.getByText("£5.50 or less")).toBeVisible();
    await expect(tour.getByText("Over £7")).toBeVisible();
    await expectTappable(tour.getByRole("button", { name: "Skip the tour" }), "tour close");
    await expectTappable(tour.getByRole("button", { name: "Skip", exact: true }), "tour skip");
    await expectTappable(tour.getByRole("button", { name: "Got it", exact: true }), "tour confirm");
    await expectNoHorizontalOverflow(page);

    await tour.getByRole("button", { name: "Skip the tour" }).click();
    await expect(tour).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pubmax-tour-v2-done"))).toBe("1");
  });

  test("does not cover the dedicated You or Pub Pal onboarding", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
        version: 1,
        activatedAt: new Date().toISOString(),
      }));
    });
    await page.goto("/u/you", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "PUBMAXXING" })).toHaveCount(0);

    await page.goto("/pal", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "PUBMAXXING" })).toHaveCount(0);
    await page.getByRole("button", { name: /Meet your Pub Pal/i }).click();
    await expect(page.getByRole("heading", { name: "The grown-up bit first." })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const actions = document.querySelector(".palOnboardingActions")?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        actionsRight: actions?.right ?? Number.POSITIVE_INFINITY,
      };
    });
    await expect(page.locator(".mobileTabBar")).toBeHidden();
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.actionsRight).toBeLessThanOrEqual(390);
  });
});
