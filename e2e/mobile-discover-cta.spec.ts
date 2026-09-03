import { expect, test } from "@playwright/test";

test("mobile discover Plan an outing card opens a mapped crawl on the map", async ({ page }) => {
  test.setTimeout(90_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/discover", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  await page.getByRole("heading", { name: "Ways to drink through the city" }).scrollIntoViewIfNeeded();
  const planTonightCta = page.getByRole("link", { name: "Plan an outing" });
  await expect(planTonightCta).toBeVisible();

  const ctaBox = await planTonightCta.boundingBox();
  expect(ctaBox, "Discover Plan an outing CTA has a tappable box").not.toBeNull();
  expect(ctaBox!.height, "Discover Plan an outing CTA touch target height").toBeGreaterThanOrEqual(44);

  await expect
    .poll(
      async () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      { message: "Discover should not horizontally overflow at 390px" },
    )
    .toBeLessThanOrEqual(1);

  await planTonightCta.click();

  await expect(page).toHaveURL(/\/map\?/);
  await expect(page).toHaveURL(/(?:crawl|pubs|pack)=/);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      { message: "Map handoff should not horizontally overflow at 390px", timeout: 20_000 },
    )
    .toBeLessThanOrEqual(1);

  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  if ((await planner.count()) === 0) await page.locator(".mobilePlanActivation").click();
  await expect(planner).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
  await expect(planner.locator(".routePanel")).toBeVisible();
  await expect.poll(() => planner.locator("ol.routeList > li").count()).toBeGreaterThan(0);
});
