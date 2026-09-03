import { expect, test, type Page } from "@playwright/test";

/**
 * Price evidence missions on the map sheet and /near.
 *
 * Auth: the signed-in lanes seed a mocked Supabase session (`seedSignedInSession`)
 * so the suite runs keyless in CI, the way playwright.config.ts webServer.env
 * already runs the app.
 */

const SEED_VENUE_ID = "venue-16pnwmm";
const SEED_VENUE_NAME = "Prospect of Whitby";
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function seedSignedInSession(page: Page): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId }) => {
    window.localStorage.setItem(
      authStorageKey,
      JSON.stringify({
        access_token: "pubmaxx-e2e-access-token",
        refresh_token: "pubmaxx-e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        expires_in: 86_400,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "price-e2e@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-07-29T00:00:00.000Z",
        },
      }),
    );
  }, {
    authStorageKey: E2E_AUTH_STORAGE_KEY,
    userId: E2E_AUTH_USER_ID,
  });
}

async function installContributorBoundary(
  page: Page,
  options: {
    failWrite?: boolean;
    missionCategory?: string;
    missionReason?: "missing" | "provisional" | "stale";
  } = {},
): Promise<{
  submitted: Array<{ venueId: string; drinkCategory: string; priceGbp: number; corroborations: number }>;
}> {
  await seedSignedInSession(page);
  const submitted: Array<{
    venueId: string;
    drinkCategory: string;
    priceGbp: number;
    corroborations: number;
  }> = [];

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "price-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: true, handle: "night_owl" }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: "night_owl" }),
    });
  });
  await page.route("**/api/price-missions**", async (route) => {
    const url = new URL(route.request().url());
    const venueId = url.searchParams.get("venueId") ?? SEED_VENUE_ID;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        mission:
          options.missionReason === "missing"
            ? { venueId, reason: "missing" }
            : {
                venueId,
                reason: options.missionReason ?? "provisional",
                drinkCategory: options.missionCategory ?? "beer",
                observedAt: Date.now() - 3_600_000,
              },
      }),
    });
  });
  await page.route("**/api/price-submit**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ prices: [], signals: [] }),
      });
      return;
    }
    if (options.failWrite) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Could not log that price right now.",
          code: "INTERNAL",
        }),
      });
      return;
    }
    const body = route.request().postDataJSON() as {
      venueId: string;
      drinkCategory: string;
      priceGbp: number;
    };
    const price = {
      venueId: body.venueId,
      drinkCategory: body.drinkCategory,
      priceGbp: body.priceGbp,
      submittedAt: Date.now(),
      source: "community",
      corroborations: 1,
    };
    submitted.push(price);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        price,
        attribution: { status: "credited", handle: "night_owl" },
      }),
    });
  });
  return { submitted };
}

async function openVenueSheet(page: Page) {
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  const inspector = venueSheet.locator(".venueInspector");
  const expand = venueSheet.getByRole("button", { name: "Expand sheet" });
  await expect.poll(async () => (await inspector.isVisible()) || (await expand.isVisible())).toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible();
  return venueSheet;
}

test.setTimeout(90_000);
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("signed-in /near shows one mission, submits, and prints the write-back receipt", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const boundary = await installContributorBoundary(page);
  const response = await page.goto("/near?patch=soho", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const slot = page.locator(".pemSlot");
  await expect(slot).toBeVisible();
  await expect(slot.locator(".pemHeading")).toContainText("Check the beer price");
  await expect(page.locator(".pemSlot")).toHaveCount(1);
  await expect(page.locator(".nmnList")).toBeVisible();

  await slot.getByRole("button", { name: "Log it" }).click();
  const priceField = slot.getByRole("textbox");
  await expect(priceField).toHaveValue("");
  await expect(slot.locator(".vpsubQuick")).toHaveCount(0);
  await priceField.fill("4.20");
  await slot.getByRole("button", { name: "Log it" }).last().click();

  await expect(slot.getByRole("status")).toContainText(
    "Another independent check is still needed.",
  );
  expect(page.url()).toContain("/near");
  expect(boundary.submitted).toHaveLength(1);
  expect(boundary.submitted[0]?.drinkCategory).toBe("beer");
  expect(errors).toEqual([]);
});

test("a failed mission write stays on /near", async ({ page }) => {
  await installContributorBoundary(page, { failWrite: true });
  await page.goto("/near?patch=soho", { waitUntil: "domcontentloaded" });
  const slot = page.locator(".pemSlot");
  await expect(slot).toBeVisible();
  await slot.getByRole("button", { name: "Log it" }).click();
  await slot.getByRole("textbox").fill("4.20");
  await slot.getByRole("button", { name: "Log it" }).last().click();
  await expect(slot.getByRole("alert")).toBeVisible();
  expect(page.url()).toContain("/near");
  await expect(slot.getByRole("textbox")).toBeVisible();
});

test("map venue sheet shows the mission and prints the write-back receipt", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await installContributorBoundary(page);
  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);
  const sheet = await openVenueSheet(page);
  const slot = sheet.locator(".pemSlot");
  await expect(slot).toBeVisible();
  await expect(slot.locator(".pemHeading")).toContainText(
    `Check the beer price at ${SEED_VENUE_NAME}`,
  );
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(submit.locator(".vpsubQuick")).toHaveCount(0);
  await submit.getByRole("textbox").fill("4.20");
  await submit.getByRole("button", { name: "Log it" }).click();
  await expect(submit.getByRole("status")).toContainText(
    "Another independent check is still needed.",
  );
  expect(errors).toEqual([]);
});

test("map sheet keeps one-tap prices when the mission is missing", async ({
  page,
}) => {
  await installContributorBoundary(page, { missionReason: "missing" });
  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);
  const sheet = await openVenueSheet(page);
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(submit).toBeVisible();
  await expect(submit.locator(".vpsubQuick")).toBeVisible();
  await expect(submit.getByRole("radiogroup")).toBeVisible();
});

test("the map sheet locks the mission's own drink, not the lane's", async ({ page }) => {
  const boundary = await installContributorBoundary(page, { missionCategory: "wine" });
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  const sheet = await openVenueSheet(page);
  const slot = sheet.locator(".pemSlot");
  await expect(slot).toBeVisible();
  await expect(slot.locator(".pemHeading")).toContainText(
    `Check the wine price at ${SEED_VENUE_NAME}`,
  );
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(submit.locator(".vpsubLockedDrink")).toHaveText("Wine");
  await submit.getByRole("textbox").fill("6.80");
  await submit.getByRole("button", { name: "Log it" }).click();
  await expect(submit.getByRole("status")).toBeVisible();
  expect(boundary.submitted).toHaveLength(1);
  expect(boundary.submitted[0]?.drinkCategory).toBe("wine");
});

for (const viewport of VIEWPORTS) {
  test(`mission geometry fits ${viewport.width}px`, async ({ page }) => {
    await installContributorBoundary(page);
    await page.setViewportSize(viewport);
    await page.goto("/near?patch=soho", { waitUntil: "domcontentloaded" });
    const slot = page.locator(".pemSlot");
    await expect(slot).toBeVisible();
    const box = await slot.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    const open = slot.getByRole("button", { name: "Log it" });
    const skip = slot.getByRole("button", { name: "Not now" });
    const openBox = await open.boundingBox();
    const skipBox = await skip.boundingBox();
    expect(openBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(skipBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
}
