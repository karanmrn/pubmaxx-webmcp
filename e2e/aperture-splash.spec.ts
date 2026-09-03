import { expect, test, type Page } from "@playwright/test";

// feat(landing): hero scroll cinema with aperture splash - PIECE 3.
// public/splash-init.js skips real automated browsers by default
// (navigator.webdriver), which every other spec in this suite relies on
// implicitly (they never see the splash). This is the one dedicated spec
// that opts back in, via page.addInitScript overriding navigator.webdriver,
// so the aperture animation itself gets real-browser proof: it appears,
// animates, and resolves within the 700ms hard ceiling with zero CLS, then
// flows into the hero cinema's dark-start frame (see
// components/landing/heroCinema.css and __tests__/heroCinemaReducedMotion.test.ts).

async function overrideWebdriver(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "webdriver", {
      get: () => false,
      configurable: true,
    });
  });
}

async function trackCls(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __pubmaxSplashCls: number }).__pubmaxSplashCls = 0;
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { value: number; hadRecentInput: boolean }
        >) {
          if (!entry.hadRecentInput) {
            (window as unknown as { __pubmaxSplashCls: number }).__pubmaxSplashCls += entry.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
  });
}

test.describe("aperture splash - eligible session (navigator.webdriver overridden)", () => {
  test("plays once, resolves within the 700ms ceiling, and holds CLS at zero", async ({ page }) => {
    await overrideWebdriver(page);
    await trackCls(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Set pre-paint by public/splash-init.js - must already be present by
    // the time Playwright can observe it, with no flash of an unstyled mark.
    const splashOn = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOn).toBe("on");

    const overlay = page.locator("#pubmax-splash");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS("position", "fixed");

    const mark = page.locator(".pubmaxSplashMark");
    await expect(mark).toBeVisible();

    // Give the sequence its full 700ms hard ceiling plus a settle margin,
    // then confirm both the backdrop and the mark have finished animating
    // (fill: forwards leaves them transparent, not removed from the DOM).
    await page.waitForTimeout(900);
    const backdropOpacity = await overlay.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(backdropOpacity)).toBeLessThan(0.05);
    const markOpacity = await mark.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(markOpacity)).toBeLessThan(0.05);

    // The overlay is inert throughout, and the hero cinema underneath - the
    // "one continuous shot" the splash resolves into - is reachable and
    // interactive once it finishes.
    await expect(overlay).toHaveCSS("pointer-events", "none");
    await expect(
      page.getByRole("heading", {
        name: "London pints can cost eight quid.",
        exact: true,
      }),
    ).toBeVisible();

    const cls = await page.evaluate(
      () => (window as unknown as { __pubmaxSplashCls: number }).__pubmaxSplashCls,
    );
    expect(cls).toBeLessThan(0.01);
  });

  test("does not replay on a second load in the same session", async ({ page }) => {
    await overrideWebdriver(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.splash))
      .toBe("on");

    await page.reload();
    const splashOnSecondLoad = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOnSecondLoad).toBeUndefined();
  });

  test("never triggers off the landing route", async ({ page }) => {
    await overrideWebdriver(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/map");
    const splashOnMap = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOnMap).toBeUndefined();
  });

  test("skips entirely under prefers-reduced-motion, even though webdriver is overridden", async ({ page }) => {
    await overrideWebdriver(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    const splashUnderReducedMotion = await page.evaluate(
      () => document.documentElement.dataset.splash,
    );
    expect(splashUnderReducedMotion).toBeUndefined();
  });
});

test.describe("aperture splash - default automated session", () => {
  test("never plays for a real automated browser (navigator.webdriver left as-is)", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    const splashDefault = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashDefault).toBeUndefined();
  });
});
