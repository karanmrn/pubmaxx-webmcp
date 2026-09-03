import { expect, test } from "@playwright/test";

for (const scenario of [
  { viewport: { width: 390, height: 844 }, colorScheme: "light" as const },
  { viewport: { width: 430, height: 932 }, colorScheme: "dark" as const },
]) {
  const { viewport, colorScheme } = scenario;
  test(`keeps Pub Pal onboarding clear at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
        version: 1,
        activatedAt: new Date().toISOString(),
      }));
    });
    await page.goto("/pal");
    const meetButton = page.getByRole("button", { name: "Meet your Pub Pal" });
    const meetButtonBox = await meetButton.boundingBox();
    expect(meetButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await meetButton.click();

    const preview = page.locator(".palOnboardingPreview");
    const panel = page.locator(".palOnboardingPanel");
    const actions = page.locator(".palOnboardingActions");
    const [previewBox, panelBox, actionsBox] = await Promise.all([
      preview.boundingBox(),
      panel.boundingBox(),
      actions.boundingBox(),
    ]);

    expect(previewBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect((previewBox?.y ?? 0) + (previewBox?.height ?? 0)).toBeLessThanOrEqual(
      (panelBox?.y ?? 0) + 1,
    );
    expect((actionsBox?.x ?? -1) + (actionsBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width,
    );
    await expect(page.locator(".palPortraitCore")).toBeVisible();
    await expect(page.locator(".palPortraitCore")).toHaveCSS("animation-name", "none");
    expect(await page.evaluate(() => document.body.scrollWidth)).toBe(viewport.width);

    await page.getByRole("checkbox", { name: /18 or over/ }).check();
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("button", { name: /^Black Cat/ }).click();
    await expect(page.getByRole("button", { name: /^Black Cat/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^Fox/ }).click();
    await expect(page.getByRole("button", { name: /^Fox/ })).toHaveAttribute("aria-pressed", "true");
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`keeps the Pub Pal first meeting composed at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: viewport.width === 1280 ? "light" : "dark" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({
        version: 1,
        activatedAt: new Date().toISOString(),
      }));
    });
    await page.goto("/pal");

    await expect(page.getByRole("heading", { name: "A little signal that becomes yours." })).toBeVisible();
    await expect(page.locator(".palPortraitCore")).toBeVisible();
    expect(await page.evaluate(() => document.body.scrollWidth)).toBe(viewport.width);
  });
}
