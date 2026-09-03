import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);
}

async function expectTapTarget(locator: Locator, label: string): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(Math.round(box.width), `${label} width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height), `${label} height`).toBeGreaterThanOrEqual(44);
}

test("mobile Rounds index explains link-based joining and routes to the map", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const response = await page.goto("/rounds");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Join with a link" })).toBeVisible();
  await expect(page.getByText(/A round opens from the link/i)).toBeVisible();

  const startOnMap = page.getByRole("link", { name: "Start a round on the map" });
  await expect(startOnMap).toHaveAttribute("href", "/map");
  await expectTapTarget(startOnMap, "start round map link");
  await expectNoHorizontalOverflow(page);

  await startOnMap.click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mobileMapLocateFab")).toBeVisible();
  await expect(page.getByRole("button", { name: "Describe the outing" })).toBeVisible();

  await page.getByRole("button", { name: "Search the map" }).click();
  await expect(page.getByRole("searchbox", { name: "Search pubs" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
