import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
test(`${viewport.label} Tonight share failure keeps status below its action`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => Promise.reject(new Error("share unavailable")),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("clipboard unavailable")) },
    });
  });

  const response = await page.goto("/tonight", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const share = page.locator(".tonightShare");
  await expect(share).toBeVisible();
  await share.click();

  const status = page.locator('.tonightEyebrowRow [role="status"]');
  await expect(status).toHaveText("Could not share tonight. Try again.");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  await expect(page.locator('.tonightShareAction [role="status"]')).toHaveCount(0);

  const actionBox = await share.boundingBox();
  const statusBox = await status.boundingBox();
  const eyebrowBox = await page.locator(".tonightEyebrow").boundingBox();
  expect(actionBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(eyebrowBox).not.toBeNull();
  expect(Math.abs(eyebrowBox!.y - actionBox!.y)).toBeLessThanOrEqual(1);
  expect(statusBox!.y, "share failure status should start below its action").toBeGreaterThanOrEqual(
    actionBox!.y + actionBox!.height,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
}
