import { expect, test, type Page } from "@playwright/test";

// Regression guard for the map's phone Tonight surface (owner bug: opening it
// gave a sheet whose lane content was absolutely positioned for the map edge —
// clipped off-canvas left, empty white body, and TWO bare × close affordances).
// The lane renders in-flow via variant="sheet"; the sheet's own header owns the
// single close. Rows are route-mocked so the populated lane path is exercised
// deterministically at 390×844, both themes.
//
// The permanent Tonight bar chip left with the one-bar pass (design judgement
// 2026-08-01, finding 2.3). P5 restored a cold-start chip under the bar when
// What's On has rows (overlay "tonight"); this spec still walks More → Events,
// which always rendered the same lane, so the in-flow sheet layout stays pinned.

function tonightRows() {
  const day = new Date().toISOString().slice(0, 10);
  return [
    {
      id: "sheet-quiz",
      venueId: "venue-xjf3n0",
      placeName: "The Arnos Arms",
      kind: "quiz",
      startsAt: `${day}T19:30:00+01:00`,
      title: "Pub quiz — 7:30pm",
      priceGbp: 2,
      source: { label: "Question One", url: "https://questionone.com/" },
      observedAt: new Date(Date.now() - 3_600_000).toISOString(),
      confidence: "listed",
    },
    {
      id: "sheet-sport",
      venueId: "venue-xjf3n0",
      placeName: "The Arnos Arms",
      kind: "sport",
      startsAt: `${day}T20:00:00+01:00`,
      title: "Screens live sport",
      source: { label: "FANZO", url: "https://www.fanzo.com/" },
      observedAt: new Date(Date.now() - 3_600_000).toISOString(),
      confidence: "derived",
    },
    {
      id: "sheet-music",
      venueId: "venue-0jly8w",
      placeName: "The Dublin Castle",
      kind: "music",
      startsAt: `${day}T20:30:00+01:00`,
      title: "Live band night",
      source: { label: "Venue site", url: "https://thedublincastle.com/" },
      observedAt: new Date(Date.now() - 3_600_000).toISOString(),
      confidence: "listed",
    },
  ];
}

async function seed(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((t) => {
    window.localStorage.setItem("pubmax-theme", t);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, theme);
  await page.route("**/api/whats-on**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: tonightRows(), asOf: new Date().toISOString() }),
    });
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(
          document.documentElement.scrollWidth - window.innerWidth,
          document.body.scrollWidth - window.innerWidth,
        ),
      ),
    )
    .toBeLessThanOrEqual(1);
}

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});
test.setTimeout(90_000);

for (const theme of ["light", "dark"] as const) {
  test(`map Tonight lane lays out in-flow with one close (${theme})`, async ({ page }) => {
    await seed(page, theme);
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 30_000 });

    await page.getByRole("button", { name: "More map controls" }).click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
    await expect(sheet).toBeVisible();
    await sheet.getByRole("tab", { name: "Events" }).click();

    // Lane renders in-flow, not the absolutely-floated map-edge card.
    const lane = sheet.locator(".tonightLane--sheet");
    await expect(lane).toBeVisible();
    await expect(lane).toHaveCSS("position", "static");

    // Cards are present and land fully on-canvas (no off-canvas-left clipping).
    const cards = sheet.locator(".tonightLaneCard");
    await expect(cards.first()).toBeVisible();
    const laneBox = await lane.boundingBox();
    expect(laneBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((laneBox?.x ?? 0) + (laneBox?.width ?? 0)).toBeLessThanOrEqual(391);

    // Exactly ONE close affordance — the sheet header's own. The lane-internal
    // collapse × and the bare pins-dismiss × must not appear inside the sheet.
    await expect(sheet.getByRole("button", { name: "Close Map controls" })).toHaveCount(1);
    await expect(sheet.locator(".tonightLaneClose")).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Dismiss tonight map pins" })).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
  });
}
