import { expect, test } from "@playwright/test";

test("mobile planner maps and hides a curated route from the bottom sheet", async ({ page }) => {
  // Full mobile route lifecycle: map, hide, remap, close to map, reopen, hide.
  // It legitimately crosses hydration + route recomputation on headless CI, and
  // runs beside other mobile specs, so keep the timeout roomy while still
  // relying on web-first assertions instead of sleeps.
  test.setTimeout(90_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });

  await expect(page.getByRole("button", { name: "Describe the outing" })).toBeVisible();
  await page.getByRole("button", { name: "Describe the outing" }).click();
  const planner = page.locator(".mapDrawer.left");
  await expect(planner).toHaveClass(/open/);
  await expect(planner).toHaveClass(/sheet-half/);
  await expect(planner.getByRole("heading", { name: "Describe the outing" })).toBeVisible();

  await planner.getByRole("button", { name: /Map the .* crawl with \d+ stops/ }).first().click();
  await planner.getByRole("button", { name: "Hide line" }).click();
  await expect(planner.getByRole("button", { name: "Map route" })).toBeVisible();
  await planner.getByRole("button", { name: "Map route" }).click();
  await expect(planner).toHaveCount(0);

  await page.getByRole("button", { name: /Edit active \d+-stop plan/ }).click();
  await expect(planner).toHaveClass(/open/);

  const reopenedHideLine = planner.getByRole("button", { name: "Hide line" });
  await reopenedHideLine.scrollIntoViewIfNeeded();
  await expect(reopenedHideLine).toBeVisible();
  await reopenedHideLine.click();
  await expect(planner.getByRole("button", { name: "Map route" })).toBeVisible();
});
