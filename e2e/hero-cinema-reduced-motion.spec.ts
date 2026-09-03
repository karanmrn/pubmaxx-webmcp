import { expect, test, type Page } from "@playwright/test";

// feat(landing): hero scroll cinema with aperture splash - PIECE 2 hard gate:
// prefers-reduced-motion gets a static composed hero, no scrub, no motion.
// Phones (<=700px) get the same static treatment regardless of motion
// preference (the phone/scrub decision for this PR: static-composed below
// 701px, no cinema treatment applies there at all). This is the real-browser
// proof companion to __tests__/heroCinemaReducedMotion.test.ts, which pins
// the same gate at the source level.

async function openLanding(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "London pints can cost eight quid.",
      exact: true,
    }),
  ).toBeVisible();
}

async function heroPhotoBox(page: Page) {
  return page.locator(".thamesHeroPhoto").evaluate((node) => {
    const style = getComputedStyle(node);
    return { borderRadius: style.borderRadius, transform: style.transform };
  });
}

test.describe("hero scroll cinema - reduced motion static hero", () => {
  test("prefers-reduced-motion: no scrub, card stays static across scroll", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLanding(page, { width: 1440, height: 900 });

    const before = await heroPhotoBox(page);
    await page.evaluate(() => window.scrollTo(0, 600));
    // Give any (unwanted) transition time to settle before re-reading.
    await page.waitForTimeout(600);
    const after = await heroPhotoBox(page);

    expect(after.borderRadius).toBe(before.borderRadius);
    expect(after.transform).toBe(before.transform);

    // --cinema-progress must never be forced open under reduced motion.
    const cinemaProgress = await page
      .locator(".lpHero")
      .evaluate((node) => getComputedStyle(node).getPropertyValue("--cinema-progress").trim());
    expect(cinemaProgress).toBe("1");
  });
});

test.describe("hero scroll cinema - phone static hero", () => {
  test("phone width (390px) gets the static-composed hero, no scrub, motion allowed", async ({ page }) => {
    await openLanding(page, { width: 390, height: 844 });

    const before = await heroPhotoBox(page);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(600);
    const after = await heroPhotoBox(page);

    expect(after.borderRadius).toBe(before.borderRadius);
    expect(after.transform).toBe(before.transform);

    const cinemaProgress = await page
      .locator(".lpHero")
      .evaluate((node) => getComputedStyle(node).getPropertyValue("--cinema-progress").trim());
    expect(cinemaProgress).toBe("1");
  });

  test("boundary width (700px) still gets the static hero (cinema opens at 701px)", async ({ page }) => {
    await openLanding(page, { width: 700, height: 900 });

    const cinemaProgress = await page
      .locator(".lpHero")
      .evaluate((node) => getComputedStyle(node).getPropertyValue("--cinema-progress").trim());
    expect(cinemaProgress).toBe("1");
  });
});
