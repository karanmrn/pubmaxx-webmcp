import { expect, test } from "@playwright/test";

test("mobile first-run tour leaves the map centre visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.removeItem("pubmax-tour-v1-done");
    window.localStorage.removeItem("pubmax-tour-v2-done");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  const dialog = page.getByRole("dialog", { name: "Pint price colours" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByText("£5.50 or less")).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  // Docked above the bottom tab bar — keep the geographic centre of the map free.
  expect(box!.y).toBeGreaterThan(844 * 0.4);

  const centre = { x: 390 / 2, y: 844 / 2 };
  const coversCentre =
    centre.x >= box!.x &&
    centre.x <= box!.x + box!.width &&
    centre.y >= box!.y &&
    centre.y <= box!.y + box!.height;
  expect(coversCentre).toBe(false);

  for (const name of ["Skip", "Got it"] as const) {
    const action = dialog.getByRole("button", { name, exact: true });
    await expect(action).toBeVisible();
    const actionBox = await action.boundingBox();
    expect(actionBox?.height).toBeGreaterThanOrEqual(44);
  }
});
