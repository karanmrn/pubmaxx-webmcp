import { expect, test } from "@playwright/test";

// Lock-In / Ledger was intentionally retired from the global product chrome.
// A stale preference may still exist on returning devices, but it must not
// replace the stable four-destination mobile navigation or turn Moment into a
// destination. The public Ledger route remains available from venue context.
test("legacy view-mode state cannot replace the current mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax-mode", "ledger");
    window.localStorage.setItem("pubmax-legacy", "1");
  });
  await page.goto("/feed");

  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const label of ["Now", "Map", "Out", "You"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(nav.locator('a[href="/social"]')).toHaveCount(0);
  // The create action is a sibling of the bar, never inside it: compose is an
  // action, and the bar holds destinations only.
  await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Create" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /ledger|lock-in/i })).toHaveCount(0);

  const destinations = await nav.locator("a[aria-current='page']").allTextContents();
  expect(destinations).toEqual([]);
});
