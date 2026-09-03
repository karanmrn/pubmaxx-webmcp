import { test, expect, type Page } from "@playwright/test";

// Mobile bottom-tab navigation coverage. The assertions deliberately target
// route DOM and accessible controls, never MapLibre's canvas or WebGL state.

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // Keep the global first-run tour from intercepting the tab bar.
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    // Keep the map's separate, session-scoped story overlay from intercepting
    // the same tab bar when a test starts on /map.
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test.describe("mobile bottom-tab navigation", () => {
  test("keeps computed route clearance while keyboard state hides the bar", async ({ page }) => {
    await page.goto("/privacy");

    const nav = primaryNav(page);
    await expect(nav).toBeVisible();
    const visiblePadding = await page.evaluate(() =>
      getComputedStyle(document.body).paddingBottom,
    );
    expect(Number.parseFloat(visiblePadding)).toBeGreaterThan(0);

    await nav.evaluate((element) => element.classList.add("isKeyboardHidden"));
    await expect(nav).toHaveCSS("opacity", "0");
    const keyboardPadding = await page.evaluate(() =>
      getComputedStyle(document.body).paddingBottom,
    );
    expect(keyboardPadding).toBe(visiblePadding);

    await nav.evaluate((element) => element.classList.remove("isKeyboardHidden"));
    await expect(nav).toHaveCSS("opacity", "1");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).paddingBottom))
      .toBe(visiblePadding);
  });

  test("hides while the planner bottom sheet owns the bottom edge", async ({ page }) => {
    await page.goto("/map");

    const nav = primaryNav(page);
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS("opacity", "1");

    await page.getByRole("button", { name: "More map controls" }).click();
    await page.getByRole("button", { name: "Plan an outing" }).click();
    await expect(page.locator(".appShell")).toHaveClass(/planning-open/);
    await expect(page.locator(".mapDrawer.left")).toHaveClass(/open/);
    await expect(nav).toHaveCSS("opacity", "0");
    await expect(nav).toHaveCSS("pointer-events", "none");

    await page.getByRole("button", { name: "Close planner" }).click();
    await expect(page.locator(".appShell")).not.toHaveClass(/planning-open/);
    await expect(nav).toHaveCSS("opacity", "1");
  });

  test("Map tab routes to /map and exposes the map search control", async ({ page }) => {
    await page.goto("/tonight");

    await primaryNav(page).getByRole("link", { name: "Map", exact: true }).click();

    await expect(page).toHaveURL(/\/map$/);
    await page.getByRole("button", { name: "Search the map" }).click();
    await expect(page.getByRole("searchbox", { name: "Search pubs" })).toBeVisible();
  });

  test("Now tab routes to the live /today or /tonight surface", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Now", exact: true }).click();

    await expect(page).toHaveURL(/\/(today|tonight)$/);
    const onToday = /\/today$/.test(page.url());
    if (onToday) {
      await expect(page.getByTestId("today-screen")).toBeVisible();
    } else {
      await expect(page.getByTestId("tonight-screen")).toBeVisible();
    }
  });

  test("Out tab routes to /out", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "Out", exact: true }).click();

    await expect(page).toHaveURL(/\/out$/);
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Out", exact: true })).toBeVisible();
  });

  test("create action opens Moment with the live return path", async ({ page }) => {
    await page.goto("/map");

    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("link", { name: "Post a moment", exact: true }).click();

    await expect(page).toHaveURL(/\/moment\?returnTo=%2Fmap$/);
    await expect(page.getByRole("heading", { name: "Keep this one." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log a Pint Drop" })).toHaveAttribute("href", "/map?log=1");
    await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/map");
  });

  test("gated Social stays out of the primary tab row", async ({ page }) => {
    await page.goto("/map");

    await expect(primaryNav(page).locator('a[href="/social"]')).toHaveCount(0);
  });

  test("You tab routes to the owned profile surface", async ({ page }) => {
    await page.goto("/map");

    await primaryNav(page).getByRole("link", { name: "You", exact: true }).click();

    await expect(page).toHaveURL(/\/u\/you$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Make the night yours." })).toBeVisible();
  });
});
