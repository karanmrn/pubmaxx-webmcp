import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px cold map keeps First visit as the only lower surface`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
      window.localStorage.removeItem("pubmax:map-chosen-area:v1");
    });

    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);

    await expect(page.locator(".mobileMapTopbar")).toBeVisible({
      timeout: 45_000,
    });
    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator(".mobileMapTopbar")).toHaveCount(1);
    await expect(page.locator(".mobileMapChipRow")).toBeHidden();
    await expect(page.locator(".mobileMapUtilityCorner")).toBeHidden();
    await expect(page.locator(".mobilePlanActivation")).toBeHidden();
    await expect(page.locator(".mapCameraControls")).toBeHidden();
    await expect(page.locator(".maplibregl-ctrl-top-right")).toBeHidden();
    await expect(page.locator(".mobileMapChrome")).toHaveAttribute("inert", "");
    await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("inert", "");

    await arrival.getByRole("button", { name: "Close" }).click();
    await expect(arrival).toHaveCount(0);
    await expect(page.locator(".mobilePlanActivation")).toBeVisible();
    await expect(page.locator(".mobileMapChrome")).not.toHaveAttribute("inert", "");
    await expect(page.locator(".mapCanvasWrap")).not.toHaveAttribute("inert", "");
  });
}
