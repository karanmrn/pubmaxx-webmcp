import { expect, test, type Page } from "@playwright/test";

const MAP_FIRST_VISIT_KEY = "pubmax:map-first-visit-arrival:v1";
const MAP_CHOSEN_AREA_KEY = "pubmax:map-chosen-area:v1";

async function armPinReveal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const revealWindow = window as typeof window & {
      __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
    };
    if (!revealWindow.__pubmaxPinRevealTrace) {
      const trace: Array<{ reason: string; generation: number }> = [];
      revealWindow.__pubmaxPinRevealTrace = trace;
      window.addEventListener("pubmax:pin-reveal", (event) => {
        trace.push(
          (event as CustomEvent<{ reason: string; generation: number }>).detail,
        );
      });
    }
  });
}

async function waitForPins(page: Page): Promise<void> {
  await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace?: unknown[];
              }
            ).__pubmaxPinRevealTrace?.length ?? 0,
        ),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
}

/** A granted fix at a fixed City of London point, so Near me is deterministic. */
const GRANTED_FIX = { latitude: 51.515, longitude: -0.09 };

async function grantLocation(page: Page): Promise<void> {
  await page.addInitScript((fix) => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: { ...fix, accuracy: 10 },
          } as GeolocationPosition);
        },
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    });
  }, GRANTED_FIX);
}

async function paintedPinCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxPaintedMapTapPoints?: () => unknown[];
        }
      ).__pubmaxPaintedMapTapPoints?.().length ?? 0,
  );
}

async function prepareFirstVisitMap(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await armPinReveal(page);
  await page.addInitScript((keys) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    if (!window.sessionStorage.getItem("pubmax-map-arrival-e2e-prepared")) {
      window.localStorage.removeItem(keys.arrival);
      window.localStorage.removeItem(keys.chosen);
      window.sessionStorage.setItem("pubmax-map-arrival-e2e-prepared", "1");
    }
  }, { arrival: MAP_FIRST_VISIT_KEY, chosen: MAP_CHOSEN_AREA_KEY });
}

test.describe("map first-visit arrival", () => {
  test("choose area remembers Camden and hides the card on return", async ({
    page,
  }) => {
    await prepareFirstVisitMap(page);
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
    await waitForPins(page);

    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 15_000 });
    await arrival.getByRole("button", { name: "Choose an area" }).click();

    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="choose-area"]');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("button", { name: /^Camden/ }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    await expect(arrival).toBeHidden();

    await expect(
      page.locator(".citySwitcher--mobile .citySwitcherLabelFull"),
    ).toHaveText("Camden");

    const stored = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, MAP_CHOSEN_AREA_KEY);
    expect(stored).toMatchObject({ label: "Camden", slug: "camden", kind: "night-area" });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
    await waitForPins(page);
    await expect(page.locator(".mapArrivalCard")).toBeHidden();
    await expect(
      page.locator(".citySwitcher--mobile .citySwitcherLabelFull"),
    ).toHaveText("Camden");
  });

  // A Near me answer is a MEMBERSHIP over the painted map, not a highlight: it
  // narrows the pins to the twenty nearest. So it describes the screen only
  // while the reader is still there, and moving to another area on purpose ends
  // it. Without that, Camden paints whichever of twenty City-of-London pins are
  // in frame - none - and the reader is shown an empty area while the sheet
  // beside it lists that area's pubs.
  test("picking an area after Near me paints that area, not an empty map", async ({
    page,
  }) => {
    await grantLocation(page);
    await prepareFirstVisitMap(page);
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
    await waitForPins(page);

    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 15_000 });
    await arrival.getByRole("button", { name: "Use my location" }).click();

    // The membership really is held: the near-me sheet is the tap path's answer.
    const nearMeSheet = page.locator('.mobileSheetPortal[data-sheet-kind="near-me"]');
    await expect(nearMeSheet).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(nearMeSheet).toBeHidden({ timeout: 15_000 });

    await page.locator(".citySwitcher--mobile .citySwitcherTrigger").click();
    await page.getByRole("button", { name: "This area" }).click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="choose-area"]');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("button", { name: /^Camden/ }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });

    await expect(
      page.locator(".citySwitcher--mobile .citySwitcherLabelFull"),
    ).toHaveText("Camden");
    // Camden is about four kilometres from the granted fix, so a surviving
    // membership leaves nothing on screen here.
    await expect.poll(() => paintedPinCount(page), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test("desktop arrival card offers location and choose area", async ({ page }) => {
    await prepareFirstVisitMap(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 45_000 });
    await waitForPins(page);

    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 15_000 });
    await expect(arrival.getByRole("button", { name: "Use my location" })).toBeVisible();
    await expect(arrival.getByRole("button", { name: "Choose an area" })).toBeVisible();
    await arrival.getByRole("button", { name: "Close" }).click();
    await expect(arrival).toBeHidden();
  });
});
