import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

// Account-gated weather Recommendations on a phone, in the dark, one-handed.
//
// The card is a WRITE surface on the venue sheet, so the browser evidence has
// to be the real thing: a real venue sheet where signed-out visitors meet the
// account gate before authoring fields mount. The matched-weather reading is a
// second test because the committed snapshot the keyless build falls back to
// is long expired, so the honest live answer here is "we couldn't check the
// weather" - that half is stubbed at the route so the "Fits tonight" wording
// is exercised rather than assumed.

const VIEWPORT = { width: 390, height: 844 };
const ARNOS_ARMS_ID = "venue-xjf3n0";
// Design-QA captures are opt-in, same deal as PW_SCREENSHOTS: an assertion run
// should not litter a working tree.
const SHOTS_DIR = process.env.WEATHER_REC_SHOTS_DIR ?? "";

test.setTimeout(120_000);

// The sheet keeps growing under the card while the rest of the venue loads, so
// the framing scroll belongs immediately before the capture, not before the
// assertions that ran in between.
async function shot(
  page: Page,
  basename: string,
  focus: Locator,
): Promise<void> {
  if (!SHOTS_DIR) return;
  await focus.evaluate((element) => {
    element.scrollIntoView({ block: "center", behavior: "instant" });
  });
  const png = await page.screenshot({ fullPage: false });
  await mkdir(SHOTS_DIR, { recursive: true });
  await writeFile(`${SHOTS_DIR}/${basename}.png`, png);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-theme", "dark");
    document.documentElement.dataset.theme = "dark";
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function openVenueCard(page: Page): Promise<Locator> {
  // The map keeps streaming tiles long after the sheet is usable, so waiting
  // for `load` would time the sheet out rather than measure it.
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);
  const details = page.locator(".venueOverviewMore");
  await expect(details).toBeVisible({ timeout: 60_000 });
  if (!(await details.evaluate((element) => element.hasAttribute("open")))) {
    await details.locator("> summary").click();
  }
  const card = page.locator(".venueWeatherRecommendations");
  await expect(card).toBeAttached({ timeout: 60_000 });
  await card.evaluate((element) => {
    element.scrollIntoView({ block: "start", behavior: "instant" });
  });
  await expect(card).toBeVisible();
  return card;
}

test("the keyless venue returns no authored weather recommendations", async ({
  request,
}) => {
  const response = await request.get(
    `/api/weather-recommendations?venueId=${ARNOS_ARMS_ID}`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    weatherStatus?: string;
    recommendations?: unknown[];
  };
  expect(body.weatherStatus).toBe("unavailable");
  expect(body.recommendations).toEqual([]);
});

test("a checkable snapshot surfaces only the matching opinion, and an uncheckable one says so", async ({
  page,
}) => {
  const rows = [
    {
      id: "rec-rain",
      venueId: ARNOS_ARMS_ID,
      condition: "raining",
      reason: "Proper fire in the back room and the roof never drips.",
      contributorHandle: "rainy_ren",
      submittedAt: Date.UTC(2026, 6, 20, 19, 30),
      source: "community",
    },
    {
      id: "rec-warm",
      venueId: ARNOS_ARMS_ID,
      condition: "warm",
      reason: "Beer garden gets the late sun until nine.",
      contributorHandle: "sunny_sam",
      submittedAt: Date.UTC(2026, 6, 21, 18, 0),
      source: "community",
    },
  ];

  let weatherCheckable = true;
  await page.route(
    "**/api/weather-recommendations?venueId=*",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          weatherCheckable
            ? {
                weatherStatus: "available",
                matchingConditions: ["raining"],
                recommendations: rows.filter(
                  (row) => row.condition === "raining",
                ),
                degraded: false,
                truncated: false,
              }
            : {
                weatherStatus: "unavailable",
                matchingConditions: [],
                recommendations: rows,
                degraded: false,
                truncated: false,
              },
        ),
      });
    },
  );

  const card = await openVenueCard(page);
  await expect(
    card.getByRole("heading", { level: 4, name: "Fits tonight" }),
  ).toBeVisible();
  await expect(card.locator(".weatherRecOpinion")).toHaveCount(1);
  await expect(card.locator(".weatherRecOpinion")).toContainText(
    "recommends this when it’s raining.",
  );
  await shot(
    page,
    "weather-recommendations-390-dark-matched",
    card.locator(".weatherRecListTitle"),
  );

  weatherCheckable = false;
  const unmatched = await openVenueCard(page);
  await expect(unmatched.getByRole("note")).toContainText(
    "We couldn’t check the weather here just now. These are Pubmaxxers’ recommendations, shown without a weather match.",
  );
  // Unconditional, not empty: both authored opinions still show.
  await expect(
    unmatched.getByRole("heading", { level: 4, name: "Pubmaxxers recommend" }),
  ).toBeVisible();
  await expect(unmatched.locator(".weatherRecOpinion")).toHaveCount(2);
  await shot(
    page,
    "weather-recommendations-390-dark-weather-unavailable",
    unmatched.getByRole("note"),
  );
});
