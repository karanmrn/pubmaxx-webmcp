import { expect, test, type Page } from "@playwright/test";

const DEVICES = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const THEMES = ["light", "dark"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("pubmax-theme", value);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
      version: 1,
      activatedAt: new Date().toISOString(),
    }));
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, theme);
}

for (const viewport of DEVICES) {
  for (const theme of THEMES) {
    test(`${viewport.width}px ${theme}: landing and Pub Pal controls stay uniform and clear`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setTheme(page, theme);
      await page.goto("/");

      const heroActions = page.locator(".lpHeroActions a");
      await expect(heroActions).toHaveCount(3);
      await expect(page.getByRole("link", { name: "Plan tonight together" }).first()).toBeVisible();

      const actionGeometry = await heroActions.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
      expect(actionGeometry.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

      const wordmark = page.getByRole("banner").locator(".lpWordmark .pubmaxxWordmark");
      await expect(wordmark).toBeVisible();
      await expect(wordmark.locator(".pubmaxxDoubleX svg")).toHaveCount(2);

      await page.goto("/pal");
      await page.getByRole("button", { name: /Meet your Pub Pal/i }).click();
      await expect(page.getByRole("heading", { name: "The grown-up bit first." })).toBeVisible();

      const palGeometry = await page.evaluate(() => {
        const actions = document.querySelector(".palOnboardingActions")?.getBoundingClientRect();
        const pal = document.querySelector(".palExperience");
        const styles = pal ? getComputedStyle(pal) : null;
        const root = getComputedStyle(document.documentElement);
        return {
          actionsRight: actions?.right ?? Number.POSITIVE_INFINITY,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          accent: styles?.getPropertyValue("--pal-accent").trim(),
          brandAccent: root.getPropertyValue("--brass").trim(),
        };
      });

      await expect(page.locator(".mobileTabBar")).toBeHidden();
      expect(palGeometry.actionsRight).toBeLessThanOrEqual(viewport.width);
      expect(palGeometry.overflow).toBeLessThanOrEqual(1);
      expect(palGeometry.accent).toBe(palGeometry.brandAccent);

      const continueButton = page.getByRole("button", { name: /Continue/i });
      const continueBox = await continueButton.boundingBox();
      expect(continueBox?.height).toBeGreaterThanOrEqual(44);
      expect(continueBox?.width).toBeGreaterThanOrEqual(44);
    });
  }
}
