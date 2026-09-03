import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test.describe("map filters sheet and bottom navigation", () => {
  test("primary tabs stay tappable above an open filters sheet", async ({ page }) => {
    await page.goto("/map");

    await page.getByRole("button", { name: /Filters/i }).click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(sheet).toBeVisible();

    const now = primaryNav(page).getByRole("link", { name: "Now", exact: true });
    await expect(now).toBeVisible();
    await now.click({ force: false });

    await expect(page).toHaveURL(/\/(today|tonight)$/);
    await expect(sheet).toHaveCount(0);
  });

  test("analytics consent stays hidden behind an open filters sheet", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
    });
    await page.goto("/map");

    const consent = page.locator(".analyticsConsentPrompt");
    await expect(consent).toBeVisible();

    await page.getByRole("button", { name: /Filters/i }).click();
    await expect(page.locator('.mobileSheetPortal[data-sheet-kind="filters"]')).toBeVisible();

    await expect(consent).toBeHidden();
  });
});
