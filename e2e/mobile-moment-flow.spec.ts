import { expect, test } from "@playwright/test";

test.describe("mobile Moment journey", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("keeps a private draft through refresh and separates Pint Drop", async ({ page }) => {
    await page.goto("/moment");

    await expect(page).toHaveURL(/\/moment$/);
    await expect(page.getByRole("heading", { name: "Keep this one." })).toBeVisible();
    await expect(page.getByRole("link", { name: /Log a Pint Drop/ })).toHaveAttribute("href", "/map?log=1");
    const captureLabel = page.getByText("Take a photo", { exact: true });
    const bottomNav = page.getByRole("navigation", { name: "Primary" });
    const [captureBox, navBox] = await Promise.all([captureLabel.boundingBox(), bottomNav.boundingBox()]);
    expect(captureBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect((captureBox?.y ?? 0) + (captureBox?.height ?? 0)).toBeLessThan(navBox?.y ?? Number.POSITIVE_INFINITY);

    const caption = page.getByPlaceholder("One line you will still remember next year.");
    await caption.fill("We followed the music and found the tiny room upstairs.");
    await expect(page.getByText("Your draft stays on this device until you save it.")).toBeVisible();
    await page.waitForTimeout(450);
    await page.reload();

    await expect(caption).toHaveValue("We followed the music and found the tiny room upstairs.");
    await expect(page.getByText("Your unfinished Moment is back.")).toBeVisible();
  });

  test("gated Social stays out of Moment primary navigation", async ({ page }) => {
    await page.goto("/moment");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).locator('a[href="/social"]'),
    ).toHaveCount(0);
  });
});
