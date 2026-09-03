import { expect, test, type Page } from "@playwright/test";

const VENUE_ID = "venue-xjf3n0";
const VENUE_NAME = "Arnos Arms";
const INTENT_KEY = "pubmax:planning-intent:v1";
const CONSENT_KEY = "pubmaxx:analytics-consent:v1";

async function captureAnalytics(page: Page): Promise<unknown[]> {
  const payloads: unknown[] = [];
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) payloads.push(JSON.parse(raw));
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  return payloads;
}

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("390px Map acceptance persists before Plan receives Stop 1", async ({ page }) => {
  await page.goto(`/map?sel=${VENUE_ID}`);
  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  const toolbar = portal.getByRole("toolbar", { name: "Venue actions" });
  const accept = toolbar.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` });
  await expect(accept).toBeVisible({ timeout: 30_000 });

  const [box, overflow] = await Promise.all([
    accept.boundingBox(),
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ]);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(overflow).toBeLessThanOrEqual(1);

  await accept.click();
  await expect(page).toHaveURL(/\/plan$/);
  const intent = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, INTENT_KEY);
  expect(intent).toMatchObject({
    source: "map-search",
    acceptedVenueId: VENUE_ID,
  });
  await expect(page.getByText("Carried over from what you accepted")).toBeVisible();
  await expect(page.getByLabel("Venue name").first()).toHaveValue(VENUE_NAME);
  await page.evaluate(() => {
    localStorage.setItem("pubmax-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
  await page.screenshot({ path: "docs/proof/venue-acceptance/accepted-plan-390-light.png" });
  await page.evaluate(() => {
    localStorage.setItem("pubmax-theme", "dark");
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: "docs/proof/venue-acceptance/accepted-plan-390-dark.png" });
});

test("Venue actions fit 320px and 390px", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/map?sel=${VENUE_ID}`);
    const toolbar = page
      .locator('.mobileSheetPortal[data-sheet-kind="venue"]')
      .getByRole("toolbar", { name: "Venue actions" });
    await expect(toolbar).toBeVisible({ timeout: 30_000 });
    const heights = await toolbar.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
    expect(heights.length).toBeGreaterThanOrEqual(3);
    expect(heights.every((height) => height >= 44)).toBe(true);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("1440px accepted arrival keeps receipt, focus, and Near provenance", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(([key, venueId]) => {
    const now = Date.now();
    sessionStorage.setItem(key, JSON.stringify({
      version: 1,
      source: "near",
      cityId: "london",
      acceptedVenueId: venueId,
      acceptedArea: { kind: "borough", name: "Camden" },
      startsAt: new Date(now + 60 * 60 * 1000).toISOString(),
      displayEvidence: {
        kind: "price",
        observedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      },
      acceptedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    }));
  }, [INTENT_KEY, VENUE_ID] as const);

  await page.goto(`/map?sel=${VENUE_ID}&accept=1&src=near`);
  await expect(page.getByText("Kept for tonight. Make it Stop 1 when you are ready.")).toBeVisible({
    timeout: 30_000,
  });
  const accept = page.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` });
  await expect(accept).toBeVisible();
  await accept.focus();
  await expect(accept).toBeFocused();
  expect(await accept.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe("none");

  await accept.click();
  await expect(page).toHaveURL(/\/plan$/);
  const intent = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, INTENT_KEY);
  expect(intent).toMatchObject({
    source: "near",
    acceptedArea: { kind: "borough", name: "Camden" },
    displayEvidence: { kind: "price", observedAt: expect.any(String) },
  });
});

test("storage denial stays on Venue and emits no acceptance events", async ({ page }) => {
  await page.addInitScript(([intentKey, consentKey]) => {
    localStorage.setItem(consentKey, "granted");
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (this === sessionStorage && key === intentKey) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return nativeSetItem.call(this, key, value);
    };
  }, [INTENT_KEY, CONSENT_KEY] as const);
  const payloads = await captureAnalytics(page);

  await page.goto(`/map?sel=${VENUE_ID}`);
  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await portal.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` }).click();

  await expect(page).toHaveURL(new RegExp(`/map\\?sel=${VENUE_ID}$`));
  await expect(portal.getByRole("alert")).toHaveText(
    "Couldn’t keep this pub on this device. Try again.",
  );
  // Visible error is action completion. Storage failed before trackEvent, so
  // no analytics request can be queued after this state.
  const acceptanceNames = payloads.flatMap((payload) => (
    payload && typeof payload === "object" && typeof (payload as { name?: unknown }).name === "string"
      ? [(payload as { name: string }).name]
      : []
  )).filter((name) => name === "venue_accepted" || name === "planning_handoff_opened");
  expect(acceptanceNames).toEqual([]);
});
