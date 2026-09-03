import { expect, test } from "@playwright/test";

const PHONE_VIEWPORT = { width: 390, height: 844 };

test("Today keeps Plan and Near below the initial phone viewport", async ({ page }) => {
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.goto("/today");
  await page.locator('[data-testid="today-screen"]:visible').waitFor();

  for (const label of ["Find pubs near you", "Plan an outing"]) {
    const link = page.getByRole("link", { name: label, exact: true });
    const box = await link.boundingBox();

    expect(box, `${label} has a rendered box`).not.toBeNull();
    expect(box!.y, `${label} starts below the initial phone viewport`).toBeGreaterThanOrEqual(
      PHONE_VIEWPORT.height,
    );
  }
});
