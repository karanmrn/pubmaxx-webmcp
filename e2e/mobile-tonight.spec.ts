import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        })),
      { message: "Tonight should not horizontally overflow at 390px" },
    )
    .toEqual({
      viewportWidth: VIEWPORT.width,
      scrollWidth: VIEWPORT.width,
      bodyScrollWidth: VIEWPORT.width,
    });
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  expect(Math.round(box!.width), `${label} width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(44);
}

test("mobile Tonight screen keeps share, filters, and rows tappable", async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/tonight");
  expect(response?.status()).toBe(200);

  const screen = page.getByTestId("tonight-screen");
  await expect(screen).toBeVisible();
  await expect(page.getByRole("heading", { name: /what.?s on near you/i })).toBeVisible();
  await expectTappable(page.locator(".tonightShare"), "Tonight share");

  await expect(page.locator(".tonightStatus, .tonightList")).toHaveCount(1, {
    timeout: 10_000,
  });

  const chips = page.locator(".tonightChip");
  for (let index = 0; index < await chips.count(); index += 1) {
    await expectTappable(chips.nth(index), `Tonight filter chip ${index + 1}`);
  }

  const rowLinks = page.locator(".tonightRowLink[href]");
  for (let index = 0; index < Math.min(await rowLinks.count(), 3); index += 1) {
    await expectTappable(rowLinks.nth(index), `Tonight row link ${index + 1}`);
  }

  await expectNoHorizontalOverflow(page);
});
