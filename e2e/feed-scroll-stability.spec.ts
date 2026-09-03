import { expect, test, type Page } from "@playwright/test";

// /feed is a legacy alias. Social is canonical, so this file guards the
// redirect and the signed-out shell that users reach after it. The retired
// FeedPageClient is not reachable through a supported browser route.

const MOBILE = { width: 390, height: 844 };

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("canonical Social route", () => {
  test("legacy /feed redirects to /social without mounting the retired feed", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    const response = await page.goto("/feed");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/social$/);
    await expect(page.locator(".socialTitle")).toBeVisible();
    await expect(page.locator(".feedTitle")).toHaveCount(0);
    await expect(page.locator(".feedCard")).toHaveCount(0);
  });

  test("signed-out Social boundary stays within the mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    const response = await page.goto("/social");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".socialTitle")).toBeVisible();
    await expect(page.locator(".socialBoundary")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Find your lot" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
