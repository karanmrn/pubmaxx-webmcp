import { test, expect, type Page } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";

function watchRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(request.url());
  });
  return requests;
}

function requested(requests: string[], fragment: string): boolean {
  return requests.some((url) => url.includes(fragment));
}

test("/map initial load uses slim pins without full or detail datasets", async ({ page }) => {
  const requests = watchRequests(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(async () =>
      page.evaluate(() => performance.getEntriesByName("pubmax:first-pins").length),
    )
    .toBeGreaterThan(0);

  // Let post-paint effects settle; a clean map must not begin planning TfL
  // journeys until the viewer opens or maps a route.
  await page.waitForTimeout(1_500);

  expect(requested(requests, "/data/venues_slim.core.json")).toBe(true);
  expect(requested(requests, "/data/pint_prices_app_dataset.json")).toBe(false);
  expect(requested(requests, "/data/venue_detail_index.json")).toBe(false);
  expect(requested(requests, "/data/venue_details.jsonl")).toBe(false);
  expect(requested(requests, "/api/venue/")).toBe(false);
  expect(requested(requests, "/api/citymcp/journey")).toBe(false);
});

test("landing night choice reaches a usable filtered mobile map", async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const requests = watchRequests(page);

  await page.goto("/#signals");
  await page.getByRole("link", { name: /Beer at .*open on the map/ }).click();

  await expect(page).toHaveURL(/\/map\?drink=beer&style=cheapest$/);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () => page.evaluate(() => performance.getEntriesByName("pubmax:first-pins").length),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole("button", { name: "Drinks" }).click();
  await expect(page.getByLabel("Drink category")).toHaveValue("beer");

  await page.waitForTimeout(1_500);
  expect(requested(requests, "/api/citymcp/journey")).toBe(false);
});

test("/map lazy-loads selected venue detail through the API", async ({ page }) => {
  const requests = watchRequests(page);

  const detailResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/venue/${SEED_VENUE_ID}`) && response.status() === 200,
  );
  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await detailResponse;
  await expect(page.locator(".venueInspector")).toBeVisible({ timeout: 20_000 });

  expect(requested(requests, "/data/venues_slim.core.json")).toBe(true);
  expect(requested(requests, `/api/venue/${SEED_VENUE_ID}`)).toBe(true);
  expect(requested(requests, "/data/pint_prices_app_dataset.json")).toBe(false);
  expect(requested(requests, "/data/venue_detail_index.json")).toBe(false);
  expect(requested(requests, "/data/venue_details.jsonl")).toBe(false);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});
