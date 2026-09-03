import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const desktopCases = [
  {
    width: 800,
    tonightState: "empty",
    tonightBody: { rows: [], asOf: "2026-07-29T18:00:00.000Z" },
  },
  {
    width: 1600,
    tonightState: "degraded",
    tonightBody: { rows: [], error: "Store unavailable" },
  },
] as const;

for (const { width, tonightState, tonightBody } of desktopCases) {
  test(`keeps Near me actionable at ${width}px with consent decided and tour unseen when Tonight is ${tonightState}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "pubmaxx:analytics-consent:v1",
        "denied",
      );
      window.localStorage.removeItem("pubmax-tour-v1-done");
    });
    await page.route("**/api/whats-on**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(tonightBody),
      }),
    );
    await page.route("**/api/citymcp/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asOf: "2026-07-29T18:00:00.000Z",
          weather: null,
          signals: [],
          tubeLines: [{ line: "Central", status: "Severe delays" }],
        }),
      }),
    );

    await page.setViewportSize({ width, height: 800 });
    const coreVenuesReady = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/data/venues_slim.core.json") &&
        candidate.ok(),
    );
    const response = await page.goto(`/map?near-me-regression=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    await coreVenuesReady;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.waitForTimeout(1_000);
    await expect(page.locator(".cityStatusBanner")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".appShell")).not.toHaveClass(/onboarding-open/);
    await expect(page.locator(".mapOnboarding")).toHaveCount(0);
    await expect(page.locator(".tourScrim")).toHaveCount(0);

    const nearMe = page.locator("button.citySuggestBannerSwitch", {
      hasText: "Near me?",
    });
    await expect(nearMe).toHaveCount(1);
    await expect(nearMe).toBeVisible();
    await expect(nearMe).toHaveAccessibleName("Near me?");
    await nearMe.click({ trial: true });
    await expect
      .poll(() =>
        page.evaluate(() =>
          navigator.permissions
            .query({ name: "geolocation" })
            .then((permission) => permission.state),
        ),
      )
      .toBe("prompt");

    await expect
      .poll(async () => (await nearMe.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    const bounds = await nearMe.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? width) + (bounds?.width ?? width)).toBeLessThanOrEqual(
      width,
    );

    const suggestBounds = await page.locator(".citySuggestBanner").boundingBox();
    const statusBounds = await page.locator(".cityStatusBanner").boundingBox();
    expect(
      (statusBounds?.y ?? 0) -
        ((suggestBounds?.y ?? 0) + (suggestBounds?.height ?? 0)),
    ).toBeGreaterThanOrEqual(8);
  });
}

test("keeps the expanded city-status feed inside an 800px viewport", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.setViewportSize({ width: 800, height: 800 });
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [] }),
    }),
  );
  await page.route("**/api/citymcp/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-29T18:00:00.000Z",
        weather: null,
        signals: Array.from({ length: 14 }, (_, index) => ({
          headline: `Status item ${index + 1}`,
          detail: "Actionable city detail",
          kind: index % 2 === 0 ? "transport" : "event",
          severity: index === 0 ? "major" : "info",
        })),
        tubeLines: [{ line: "Central", status: "Severe delays" }],
      }),
    }),
  );

  const response = await page.goto("/map?status-sheet-viewport=800", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const statusToggle = page.locator(".cityStatusBannerLink");
  await expect(statusToggle).toBeVisible({ timeout: 20_000 });
  await statusToggle.click();

  const sheet = page.locator(".cityStatusSignalSheet");
  await expect(sheet).toBeVisible();
  const bounds = await sheet.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.y ?? 800) + (bounds?.height ?? 800)).toBeLessThanOrEqual(784);

  await sheet.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const lastRow = sheet.locator(".cityStatusSignalRow").last();
  const lastBounds = await lastRow.boundingBox();
  expect(lastBounds).not.toBeNull();
  expect(
    (lastBounds?.y ?? 800) + (lastBounds?.height ?? 800),
  ).toBeLessThanOrEqual(784);
});
