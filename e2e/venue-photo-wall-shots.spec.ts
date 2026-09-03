// Evidence shots of the pub photo wall, at the phone width most people hold and
// at a desktop width. Not a fence: it asserts only enough to fail loudly when
// the surface it is meant to photograph did not render, so a green run cannot
// hand over a picture of an empty box.
//
// Run it on demand:
//   PW_NEXT_DIST_DIR=.next-e2e npx playwright test e2e/venue-photo-wall-shots.spec.ts

import { expect, test, type Page } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";
const OUT = process.env.PUBMAX_SHOT_DIR ?? "/tmp/pubmax-photo-wall";

async function settle(page: Page): Promise<void> {
  await expect(
    page.getByRole("status", { name: "Loading the London pub map." }),
  ).toBeHidden({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("phone: the wall on the venue sheet at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  await expect(
    page.locator('.mobileSheetPortal[data-sheet-kind="venue"]'),
  ).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await page.locator("#venueTab-photos").click();
  const wall = page.locator("#venuePanel-photos .venuePhotoWall");
  await expect(wall).toBeVisible();
  await expect(wall.getByRole("heading", { name: "Photo wall" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/phone-390-photo-wall.png`, fullPage: false });

  // The composer, where a photo is chosen, tagged and captioned.
  const add = wall.getByRole("button", { name: "Add a photo" });
  if (await add.count()) {
    await add.click();
    await expect(wall.locator(".venuePhotoComposer")).toBeVisible();
    await page.screenshot({ path: `${OUT}/phone-390-photo-composer.png`, fullPage: false });
  }
});

test("desktop: the wall on the venue surface at 1440x900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  await expect(page.locator("#venuePanel-overview")).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await page.locator("#venueTab-photos").click();
  const wall = page.locator("#venuePanel-photos .venuePhotoWall");
  await expect(wall).toBeVisible();
  await page.screenshot({ path: `${OUT}/desktop-1440-photo-wall.png`, fullPage: false });
});

test("desktop: the wall on the pub's own ledger page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto(`/ledger/${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);
  const wall = page.locator(".venuePhotoWall");
  await expect(wall).toBeVisible({ timeout: 30_000 });
  await wall.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/desktop-1440-ledger-photo-wall.png`, fullPage: false });
});
