import { test, expect, type Page } from "@playwright/test";

// D7 — a crawl stop card has to answer two questions on its own: which pub is
// this, and how long is the walk to it.
//
// Production answered neither. A Camden route printed two cards both reading
// "The Queens Head" over "Camden", with nothing else to separate them. And each
// card carried its own straight-line walk line PLUS a TfL journey line that was
// walk-only, so one leg read as two different walk times.
//
// The two seeded pubs below are the same pair: both "The Queens Head", both
// Camden, one on Acton St and one on Theobalds Rd. WebGL is never touched — the
// route is seeded through the URL, exactly as a shared crawl link does.

const QUEENS_HEAD_ACTON_ST = "venue-1u82rds";
const QUEENS_HEAD_THEOBALDS_RD = "venue-b85at0";
const FRIEND_AT_HAND = "venue-yl1a48";
// Three stops, so a middle card carries both a leg of its own and a journey.
// With two stops the off-by-one hid itself: the only leg sat on card 1 while the
// only journey was keyed to card 2, which has no leg block to print it in.
const SEEDED_PUBS = [QUEENS_HEAD_ACTON_ST, QUEENS_HEAD_THEOBALDS_RD, FRIEND_AT_HAND].join(",");
const SEEDED_STOP_COUNT = 3;

async function mockJourney(page: Page, modes: string[], minutes: number): Promise<void> {
  await page.route("**/api/citymcp/journey**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        journeys: [
          {
            durationMinutes: minutes,
            legs: modes.map((mode) => ({ mode, durationMinutes: minutes })),
          },
        ],
      }),
    }),
  );
}

async function openSeededCrawl(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  // plan=1 opens the planner on arrival (lib/mapArrival), so the stop cards
  // mount without a click on the canvas.
  const response = await page.goto(`/map?mode=build&plan=1&pubs=${SEEDED_PUBS}`);
  expect(response?.status()).toBe(200);

  const routePanel = page.locator(".routePanel");
  await expect(routePanel).toBeVisible({ timeout: 45_000 });
  const stops = routePanel.locator("ol.routeList > li");
  await expect
    .poll(async () => await stops.count(), { timeout: 20_000 })
    .toBe(SEEDED_STOP_COUNT);
  return { routePanel, stops };
}

test.describe("crawl stop cards (D7)", () => {
  test("two stops sharing a name read as different places", async ({ page }) => {
    test.setTimeout(120_000);
    await mockJourney(page, ["walking"], 5);
    const { stops } = await openSeededCrawl(page);

    // The name's own text node — the heading also carries a Pint Drop count chip.
    const names = await stops
      .locator("strong")
      .evaluateAll((nodes) => nodes.map((node) => (node.childNodes[0]?.textContent ?? "").trim()));
    expect(names[0]).toBe(names[1]);
    expect(names[0]).toBe("The Queens Head");

    const places = (await stops.locator("small").allInnerTexts()).map((text) => text.trim());
    expect(places).toHaveLength(SEEDED_STOP_COUNT);
    expect(places[0]).not.toBe(places[1]);
    // The area alone cannot separate them, so the street joins it — cased like
    // the place name it is, not like the search key it was recovered from.
    for (const place of places.slice(0, 2)) {
      expect(place).toContain("Camden");
      expect(place).toMatch(/^[A-Z]/);
    }
  });

  test("a walk-only journey never prints a second walk time", async ({ page }) => {
    test.setTimeout(120_000);
    await mockJourney(page, ["walking"], 5);
    const { routePanel } = await openSeededCrawl(page);

    // A route of N stops carries N-1 legs (lib/routeLegs.buildRouteLegs).
    const legs = routePanel.locator(".routeLeg");
    await expect(legs).toHaveCount(SEEDED_STOP_COUNT - 1);
    await expect(routePanel.locator(".routeLegTransit")).toHaveCount(0);

    // Every card states one time, and states it once.
    for (const text of await legs.allInnerTexts()) {
      expect(text).toMatch(/\d+\s*min\s*walk/);
      expect(text.match(/\d+\s*min/g) ?? []).toHaveLength(1);
    }
  });

  test("a journey that uses transit still earns its own line", async ({ page }) => {
    test.setTimeout(120_000);
    await mockJourney(page, ["walking", "bus", "walking"], 16);
    const { routePanel } = await openSeededCrawl(page);

    // One per leg, each on the card whose own leg it measures.
    const transit = routePanel.locator(".routeLegTransit");
    await expect(transit).toHaveCount(SEEDED_STOP_COUNT - 1);
    await expect(transit.first()).toContainText("bus");
  });
});
