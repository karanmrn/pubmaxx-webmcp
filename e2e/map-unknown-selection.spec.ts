import { expect, test, type Page } from "@playwright/test";

// Honesty for a bogus `?sel=`: show a quiet note, keep the map open, do not
// open a venue sheet. A real `?sel=` still opens the sheet.

const MOBILE = { width: 390, height: 844 };

function stableVenueIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}
function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);
const ALIASED_VENUE_ID = "venue-11h1ycl";
const CANONICAL_VENUE_ID = "venue-1g0tt6c";

const venuePortal = (page: Page) =>
  page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');

function dismissFirstRunChrome(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

test.describe("unknown ?sel= honesty", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dismissFirstRunChrome(page);
  });

  test("a bogus ?sel= shows the quiet note and never opens the venue sheet", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map?sel=the-dove-hammersmith");

    await expect(page.getByTestId("unknown-map-selection")).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByTestId("unknown-map-selection")).toContainText(
      "That pub is not one we know.",
    );
    await expect(venuePortal(page)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.has("sel")).toBe(false);

    await page.reload();
    await expect(page.getByTestId("unknown-map-selection")).toHaveCount(0);
  });

  test("a failed lookup stays distinct from an unknown pub", async ({ page }) => {
    await page.route("**/api/venue/venue-transient-failure", async (route) => {
      await route.fulfill({ status: 503, body: "Service unavailable" });
    });

    await page.goto("/map?sel=venue-transient-failure");

    await expect(page.getByTestId("map-selection-lookup-failed")).toContainText(
      "We could not check that pub right now.",
      { timeout: 45_000 },
    );
    expect(new URL(page.url()).searchParams.get("sel")).toBe("venue-transient-failure");
    await expect(page.getByTestId("unknown-map-selection")).toHaveCount(0);
  });

  test("an aliased ?sel= opens its canonical venue", async ({ page }) => {
    await page.goto(`/map?sel=${ALIASED_VENUE_ID}`);

    await expect(venuePortal(page)).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(
      CANONICAL_VENUE_ID,
    );
    await expect(page.getByTestId("unknown-map-selection")).toHaveCount(0);
  });

  test("a valid ?sel= still opens the venue sheet", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);

    await expect(venuePortal(page)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("unknown-map-selection")).toHaveCount(0);
  });
});
