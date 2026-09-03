import { expect, test } from "@playwright/test";

test("1280px keeps the Free badge outside the drink-lane arrow and edge fade", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  const response = await page.goto("/discover", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const lowNo = page.locator(".discoverLowNoItem");
  await expect(lowNo).toBeVisible();
  await lowNo.scrollIntoViewIfNeeded();

  const layout = await page.locator(".discoverExplore").evaluate((showcase) => {
    const grid = showcase.querySelector<HTMLElement>(".catShowcase__grid");
    const badge = showcase.querySelector<HTMLElement>(".discoverLowNoBadge");
    const previous = showcase.querySelector<HTMLElement>(
      ".catShowcase__arrow--prev",
    );
    if (!grid || !badge || !previous) {
      throw new Error("Discover drink lane is incomplete");
    }
    const gridBox = grid.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    const previousBox = previous.getBoundingClientRect();
    const overlapWidth = Math.max(
      0,
      Math.min(badgeBox.right, previousBox.right) -
        Math.max(badgeBox.left, previousBox.left),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(badgeBox.bottom, previousBox.bottom) -
        Math.max(badgeBox.top, previousBox.top),
    );
    return {
      badgeText: badge.textContent?.trim() ?? "",
      badgeLeftInGrid: badgeBox.left - gridBox.left,
      overlapArea: overlapWidth * overlapHeight,
    };
  });

  expect(layout.badgeText).toBe("Free");
  expect(
    layout.badgeLeftInGrid,
    "badge starts beyond the 44px desktop edge fade",
  ).toBeGreaterThanOrEqual(44);
  expect(
    layout.overlapArea,
    "desktop previous-arrow never paints over the badge",
  ).toBe(0);
});
