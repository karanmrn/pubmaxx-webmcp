import { expect, test } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";
const SEED_VENUE_NAME = "Prospect of Whitby";
const VIEWPORT = { width: 390, height: 844 };

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("a drinker opens the existing price form from the venue action", async ({
  page,
}) => {
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await sheet
    .getByRole("button", { name: `Add a price at ${SEED_VENUE_NAME}` })
    .click();

  const priceField = sheet.getByRole("textbox", {
    name: `Price of a beer at ${SEED_VENUE_NAME}, in pounds`,
  });
  await expect(priceField).toBeVisible();
  await expect(priceField).toBeFocused();
});

test("desktop venue sheet exposes the same clear price action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);

  const sheet = page.locator(".mapDrawer.right");
  await sheet
    .getByRole("button", { name: `Add a price at ${SEED_VENUE_NAME}` })
    .click();

  await expect(
    sheet.getByRole("textbox", {
      name: `Price of a beer at ${SEED_VENUE_NAME}, in pounds`,
    }),
  ).toBeVisible();
});
