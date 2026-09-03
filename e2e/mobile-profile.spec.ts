import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_handle", "mobileqa-viewer");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      })),
    )
    .toEqual({
      clientWidth: MOBILE_VIEWPORT.width,
      scrollWidth: MOBILE_VIEWPORT.width,
      bodyScrollWidth: MOBILE_VIEWPORT.width,
    });
}

async function expectTapTargetsAtLeast44(locator: Locator, label: string): Promise<void> {
  const count = await locator.count();
  expect(count, `${label} should exist`).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const control = locator.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box, `${label} #${i + 1} should have a layout box`).not.toBeNull();
    if (!box) continue;
    expect(Math.round(box.width), `${label} #${i + 1} width`).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height), `${label} #${i + 1} height`).toBeGreaterThanOrEqual(44);
  }
}

test.describe("mobile profile social actions", () => {
  test("visitor profile actions stay thumb-safe without horizontal overflow", async ({ page }) => {
    const response = await page.goto("/u/mobileqa-target");
    expect(response?.status()).toBe(200);

    const profile = page.locator(".profilePage");
    await expect(profile).toBeVisible();
    await expect(page.locator(".profileHandle")).toContainText("@mobileqatarget");

    const actions = profile.locator(".profileActions");
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("button", { name: /follow/i })).toBeVisible();
    await expectTapTargetsAtLeast44(
      actions.locator("a, button").and(page.locator(":visible")),
      "profile action",
    );

    await expectNoHorizontalOverflow(page);
  });
});
