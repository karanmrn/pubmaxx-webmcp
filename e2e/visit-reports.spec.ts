import { expect, test, type Page } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";
const VIEWPORT = { width: 390, height: 844 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmax_handle");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("a signed-out visitor sees the account gate before visit-report fields mount", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("status", { name: "Loading the London pub map." }),
  ).toBeHidden({ timeout: 30_000 });
  await page.locator("#venueTab-story").click();

  const story = page.locator("#venuePanel-story");
  await expect(story).toBeVisible();
  const lane = story.locator(".visitReportPanel");
  await expect(lane).toBeVisible();
  const gate = lane.getByRole("button", { name: "Sign in to contribute" });
  await expect(gate).toBeVisible();
  expect((await gate.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await expect(lane.getByLabel("When were you there?")).toHaveCount(0);
  await expect(lane.getByLabel("One short account")).toHaveCount(0);
  await expect(lane.getByLabel("Your contributor handle")).toHaveCount(0);
  await expect(
    lane.getByRole("button", { name: "Add visit account" }),
  ).toHaveCount(0);

  await gate.click();
  const dialog = page.getByRole("dialog", { name: "Sign in to contribute" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Account needed");
  await expect(dialog.getByRole("button", { name: "Not now" })).toBeVisible();

  expect(
    await lane.locator('[aria-label*="star" i], .starRating').count(),
  ).toBe(0);
  const fits = await lane.evaluate(
    (element) => element.scrollWidth <= element.clientWidth + 1,
  );
  expect(fits).toBe(true);
  expect(errors).toEqual([]);
});
