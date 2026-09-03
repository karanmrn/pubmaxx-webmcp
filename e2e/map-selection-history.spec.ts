import { expect, test, type Page } from "@playwright/test";

// Trusted-handoff §4.6 (selection-history sentinel) + §4.7 (shared onboarding
// intent). These assert the exact Back/close contract for the Map Venue sheet
// and that an explicit Venue arrival stands the first-run tour down — the two
// behaviours L05 owns. All are same-document history navigations, so no canvas
// interaction is needed (the push/replace/switch decisions are unit-tested in
// __tests__/mapSelectionHistory.test.ts).

const MOBILE = { width: 390, height: 844 };

// Stable slim-pin id for "Arnos Arms" (same derivation the app uses), so a
// `?sel=` deep link resolves to a real Venue and opens the sheet.
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

const venuePortal = (page: Page) =>
  page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');

function dismissFirstRunChrome(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

test.describe("§4.6 selection-history Back/close contract", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dismissFirstRunChrome(page);
  });

  test("Back over a deep-linked Venue closes the sheet, then a second Back leaves the Map", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // Establish a real previous page so the second Back has somewhere to go.
    await page.goto("/tonight");
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);

    await expect(venuePortal(page)).toBeVisible();
    // The checkpoint replaced the incoming entry with a clean Map and pushed the
    // selected entry carrying the sentinel.
    await expect
      .poll(() => page.evaluate(() => (window.history.state as { pubmaxSelection?: number } | null)?.pubmaxSelection ?? null))
      .toBe(1);

    // First Back: the selected entry pops → sheet closes, clean Map remains.
    await page.goBack();
    await expect(venuePortal(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/map$/);

    // Second Back: leave the Map entirely.
    await page.goBack();
    await expect(page).toHaveURL(/\/tonight$/);
  });

  test("the Close button pops the selected entry and a reload stays clean", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);

    const portal = venuePortal(page);
    await expect(portal).toBeVisible();

    await portal.getByRole("button", { name: "Close pub detail" }).click();
    await expect(portal).toHaveCount(0);
    await expect(page).toHaveURL(/\/map$/);
    await expect
      .poll(() => page.evaluate(() => new URL(window.location.href).searchParams.get("sel")))
      .toBeNull();

    // A reload of the clean Map does not resurrect the closed sheet.
    await page.reload();
    await expect(venuePortal(page)).toHaveCount(0);
  });

  test("Forward restores one selected entry and one Back closes it", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);

    const portal = venuePortal(page);
    await expect(portal).toBeVisible();
    await portal.getByRole("button", { name: "Close pub detail" }).click();
    await expect(portal).toHaveCount(0);
    await expect(page).toHaveURL(/\/map$/);

    await page.goForward();
    await expect(portal).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window.history.state as {
                pubmaxSelection?: number;
                venueId?: string;
              } | null
            )?.venueId ?? null,
        ),
      )
      .toBe(ARNOS_ARMS_ID);

    await page.goBack();
    await expect(portal).toHaveCount(0);
    await expect(page).toHaveURL(/\/map$/);
  });

  test("a reload with the Venue selected retains the sheet (§4.6 reload retains)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    await expect(venuePortal(page)).toBeVisible();

    await page.reload();
    await expect(venuePortal(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`sel=${ARNOS_ARMS_ID}`));
  });
});

test.describe("§4.7 explicit Map arrival suppresses the first-run tour", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Deliberately do NOT dismiss the tour — it must be eligible.
  });

  test("no tour over a deep-linked Venue, nor over a planner (plan=1) arrival", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const tour = page.getByRole("dialog", { name: "PUBMAXXING" });

    // Deep-linked Venue: the sheet mounts and the tour is suppressed for it.
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    await expect(venuePortal(page)).toBeVisible();
    await expect(tour).toHaveCount(0);

    // A planner deep link is also explicit intent — no tour over it.
    await page.goto("/map?plan=1");
    await expect(page.getByRole("heading", { name: "Describe the outing" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(tour).toHaveCount(0);
  });
});
