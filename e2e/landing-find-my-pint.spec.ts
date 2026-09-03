import { expect, test, type Page } from "@playwright/test";

// Permanent one-action hierarchy. No build flag changes this contract.

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

// The landing document is CDN-held, so its Social label is the first one most
// strangers read: it has to agree with the site nav, the palette and /social.
test("landing nav and footer name Social", async ({ page }) => {
  await openLanding(page, { width: 1440, height: 900 });

  const nav = page.getByRole("navigation", { name: "Landing navigation" });
  await expect(
    nav.getByRole("link", { name: "Social", exact: true }),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "Social preview", exact: true })).toHaveCount(0);

  const footerSocial = page
    .locator(".lpFooterCol")
    .getByRole("link", { name: "Social", exact: true });
  await expect(footerSocial).toHaveCount(1);
});

test.describe("landing Pub Pal hierarchy", () => {
  test("keeps Meet your Pub Pal primary with Plan, Map and location as secondary text", async ({ page }) => {
    await openLanding(page, { width: 1440, height: 900 });

    const hero = page.locator(".lpHeroActions");
    await expect(hero).toBeVisible();
    await expect(hero).toHaveClass("lpHeroActions");

    const primaries = hero.locator(".lpButtonPrimary");
    await expect(primaries).toHaveCount(1);
    await expect(primaries.first()).toHaveAttribute("href", "/pal");
    await expect(primaries.first()).toContainText("Meet your Pub Pal");

    // No quiet equal-weight button pair under the map-first hero.
    await expect(hero.locator(".lpButtonQuiet")).toHaveCount(0);

    const secondary = hero.locator(".lpHeroSecondaryRow");
    await expect(secondary).toBeVisible();
    const mapLink = secondary.getByRole("link", { name: /Open the map/i });
    const nearLink = secondary.getByRole("link", { name: /Find my pint/i });
    await expect(mapLink).toBeVisible();
    await expect(nearLink).toBeVisible();
    await expect(mapLink).toHaveClass(/lpTextLink/);
    await expect(nearLink).toHaveClass(/lpTextLink/);
    await expect(mapLink).toHaveAttribute("href", "/choose-city");
    await expect(nearLink).toHaveAttribute("href", "/near?locate=1");
  });

  // Both viewports, because the retired flag-on spec proved the fold on the
  // desktop screen too and a mobile-only check cannot see a hero that grows on
  // a wide layout.
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ] as const) {
    test(`dominant primary stays tappable and above the fold at ${viewport.width}`, async ({ page }) => {
      await openLanding(page, viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      const hero = page.locator(".lpHeroActions");
      await expect(hero.getByRole("link", { name: /Plan tonight together/i })).toHaveAttribute("href", "/plan");
      await expect(hero.getByRole("link", { name: /Open the map/i })).toHaveAttribute("href", "/choose-city");
      await expect(hero.getByRole("link", { name: /Find my pint/i })).toHaveAttribute("href", "/near?locate=1");
      const primary = hero.locator(".lpButtonPrimary");
      await expect(primary).toHaveCount(1);
      await expect(primary).toContainText("Meet your Pub Pal");
      const box = await primary.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 1);
      // No equal-weight Map/Plan button pair beside the one primary.
      await expect(hero.locator(".lpButtonQuiet")).toHaveCount(0);
    });
  }
});
