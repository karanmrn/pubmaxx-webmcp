import { expect, test, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
}

test("mobile Discover shows Night Area evidence states without promising routes", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/discover", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const coverage = page.locator(".nightAreaCoverage");
  await expect(coverage).toBeVisible();
  await expect(coverage.getByRole("heading", { name: "Areas near you, with the gate visible" })).toBeVisible();
  await expect(coverage).toContainText("Only an area with a complete, live gate can produce a Crawl Route");
  await expect(coverage.getByRole("link", { name: "Open planner", exact: true })).toHaveAttribute("href", "/plan");
  await expectNoHorizontalOverflow(page);

  const plannerLink = coverage.getByRole("link", { name: /Open the planner from / }).first();
  const plannerBox = await plannerLink.boundingBox();
  expect(plannerBox?.height ?? 0, "route-ready action should be thumb-safe").toBeGreaterThanOrEqual(44);

  const details = coverage.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(details.locator('[data-route-ready="true"]').first()).toBeVisible();
  await expect(details.locator('[data-coverage-status="captured"]').first()).toBeVisible();
  await expect(details.locator('[data-coverage-status="reviewed"]').first()).toBeVisible();
  await expect(details.locator('[data-coverage-status="discovered"]').first()).toBeVisible();
  await expect(details.locator('[data-coverage-status="paused"]').first()).toBeVisible();
  await expect(details.getByRole("link", { name: /See .* pubs on the map/ }).first()).toHaveAttribute(
    "href",
    /\/map\?q=/,
  );
  await expectNoHorizontalOverflow(page);
});
