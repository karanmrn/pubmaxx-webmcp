import { expect, test } from "@playwright/test";

// Stable Prospect of Whitby seed from the slim keyless index.
const VENUE_ID = "venue-16pnwmm";
const USER_LOCATION = { latitude: 51.6074, longitude: -0.1278 };

test.use({
  geolocation: USER_LOCATION,
  permissions: ["geolocation"],
  viewport: { width: 390, height: 844 },
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

test("keeps location private, supports forgetting, and shows useful routes", async ({
  page,
}) => {
  let journeyRequests = 0;
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.route("**/api/citymcp/journey", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.url()).not.toContain(String(USER_LOCATION.latitude));
    expect(request.url()).not.toContain(String(USER_LOCATION.longitude));
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(body.fromLat).toBe(51.607);
    expect(body.fromLng).toBe(-0.128);
    expect(body.limit).toBe(3);
    journeyRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        journeys: [
          {
            durationMinutes: 21,
            legs: [{ mode: "walking" }, { mode: "tube" }],
          },
          {
            durationMinutes: 14,
            legs: [
              { mode: "walking" },
              { mode: "bus" },
              { mode: "walking" },
            ],
          },
        ],
      }),
    });
  });

  const response = await page.goto(`/map?sel=${VENUE_ID}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible({ timeout: 45_000 });
  await expect(venueSheet.getByRole("tab", { name: "Overview" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const gettingThere = venueSheet.getByRole("region", { name: "Getting there" });
  const shareLocation = page.getByRole("button", {
    name: "Share location for travel times",
  });
  await expect(shareLocation).toBeVisible();
  await expect(gettingThere).toContainText("approximate point is sent to CityMCP");
  const venueOnlyMaps = gettingThere.getByRole("link", {
    name: "Open venue in Google Maps without sharing your location",
  });
  await expect(venueOnlyMaps).toBeVisible();
  expect(new URL((await venueOnlyMaps.getAttribute("href"))!).searchParams.get("origin"))
    .toBeNull();
  await shareLocation.click();

  await expect(gettingThere).toContainText("Walk");
  await expect(gettingThere).toContainText("TfL");
  await expect(gettingThere).toContainText("14 min · walk → bus → walk");
  await expect.poll(() => journeyRequests).toBe(1);

  const maps = gettingThere.getByRole("link", { name: /Open directions/ });
  const href = await maps.getAttribute("href");
  expect(href).toBeTruthy();
  const directions = new URL(href!);
  expect(directions.searchParams.get("origin")).toBe("51.607,-0.128");

  await gettingThere.getByRole("button", { name: "Forget" }).click();
  await expect(
    gettingThere.getByRole("button", { name: "Share location for travel times" }),
  ).toBeVisible();
  await expect(gettingThere).not.toContainText("14 min");
  await expect(gettingThere).toContainText("without sharing your location");

  await gettingThere
    .getByRole("button", { name: "Share location for travel times" })
    .click();
  await expect.poll(() => journeyRequests).toBe(2);
});

test("announces location progress and retries a failed route request", async ({ page }) => {
  let journeyRequests = 0;
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.route("**/api/citymcp/journey", async (route) => {
    journeyRequests += 1;
    if (journeyRequests === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        journeys: [
          {
            durationMinutes: 12,
            legs: [{ mode: "walking" }, { mode: "tube" }],
          },
        ],
      }),
    });
  });

  await page.goto(`/map?sel=${VENUE_ID}`);
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible({ timeout: 45_000 });
  const gettingThere = venueSheet.getByRole("region", { name: "Getting there" });
  await gettingThere
    .getByRole("button", { name: "Share location for travel times" })
    .click();
  await expect(gettingThere.getByRole("button", { name: "Retry routes" })).toBeVisible();
  await gettingThere.getByRole("button", { name: "Retry routes" }).click();
  await expect(gettingThere).toContainText("12 min · walk → tube");
  await expect.poll(() => journeyRequests).toBe(2);
});
