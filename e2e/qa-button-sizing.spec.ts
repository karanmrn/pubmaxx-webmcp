import { expect, test, type Locator, type Page } from "@playwright/test";

const ARNOS_ARMS_ID = "venue-xjf3n0";

async function seedChrome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function expectTapTarget(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${label} width`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
}

test.setTimeout(90_000);

test("desktop map camera and favourite-pint controls meet the tap floor", async ({ page }) => {
  await seedChrome(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 45_000 });
  await expectTapTarget(
    page.locator(".mapToolbarDesktopExtras .favoritePintControl"),
    "favourite pint control",
  );
  await expectTapTarget(page.locator(".mapFitLondonBtn"), "map fit control");
});

test("existing Last Train destinations keep Cancel at the tap floor", async ({ page }) => {
  await seedChrome(page);
  await page.addInitScript(() => {
    window.sessionStorage.setItem("pubmax:last-train-destination:v1", "Home");
  });
  await page.route("**/api/last-train**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        station: { id: "station", name: "Arnos Grove", distanceM: 320 },
        trains: [],
        departures: [],
        nearestPubs: [],
        generatedAt: new Date().toISOString(),
        decision: {
          decision: "live_data_unavailable",
          leaveByIso: null,
          stationName: "Arnos Grove",
          lineNames: [],
          disruptionSummary: null,
          walkMinutesEstimate: 0,
          bufferMinutes: 5,
          destinationLabel: "Home",
          live: false,
        },
      }),
    }),
  );
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  await page.getByRole("tab", { name: "Last train", exact: true }).click();
  const card = page.getByLabel("Last Pint");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Change", exact: true }).click();
  await expectTapTarget(card.getByRole("button", { name: "Cancel", exact: true }), "destination cancel");
});
