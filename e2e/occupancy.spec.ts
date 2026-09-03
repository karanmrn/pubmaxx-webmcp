import { expect, test, type Page } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";
const VIEWPORT = { width: 390, height: 844 };
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000011";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";

test.use({ serviceWorkers: "block" });

function occupancyPath(url: string): boolean {
  return /\/api\/venues\/[^/]+\/occupancy(?:\?|$)/.test(url);
}

async function seedSignedInSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ authStorageKey, userId }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
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
            email: "occupancy-e2e@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-08-16T00:00:00.000Z",
          },
        }),
      );
    },
    { authStorageKey: E2E_AUTH_STORAGE_KEY, userId: E2E_AUTH_USER_ID },
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("a signed-out visitor sees the reading and the sign-in door", async ({
  page,
}) => {
  await page.route("**/api/venues/**/occupancy", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        now: "some-seats",
        ageMinutes: 12,
        reportersLast90: 1,
        degraded: false,
        state: "fresh",
      }),
    });
  });

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  const row = sheet.locator(".venueOccupancy");
  await expect(row).toBeVisible();
  await expect(row.getByText("How busy is it right now?")).toBeVisible();
  await expect(row.getByText("Some seats · 12 min ago · 1 person")).toBeVisible();
  const signIn = row.getByRole("link", { name: "Sign in to report" });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute(
    "href",
    "/login?mode=signin&from=%2Fmap%3Fsel%3Dvenue-16pnwmm",
  );
  await expect(row.getByRole("button", { name: "Empty" })).toHaveCount(0);

  await signIn.click();
  await expect(page).toHaveURL(/\/login\?mode=signin&from=/);
  expect(new URL(page.url()).searchParams.get("from")).toBe(
    `/map?sel=${SEED_VENUE_ID}`,
  );
});

test("a signed-in tap writes a receipt then an aged reading", async ({
  page,
}) => {
  await seedSignedInSession(page);
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "occupancy-e2e@example.test",
      }),
    });
  });

  let aged = false;
  await page.route("**/api/venues/**/occupancy", async (route) => {
    if (!occupancyPath(route.request().url())) {
      await route.continue();
      return;
    }
    if (route.request().method() === "POST") {
      aged = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          now: "some-seats",
          ageMinutes: 0,
          reportersLast90: 1,
          degraded: false,
          state: "fresh",
          level: "some-seats",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        aged
          ? {
              now: "some-seats",
              ageMinutes: 12,
              reportersLast90: 1,
              degraded: false,
              state: "fresh",
            }
          : {
              now: null,
              ageMinutes: null,
              reportersLast90: 0,
              degraded: false,
              state: "none",
            },
      ),
    });
  });

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  const row = sheet.locator(".venueOccupancy");
  await expect(row).toBeVisible();
  await expect(row.getByText("No fresh reading")).toBeVisible();

  const tap = row.getByRole("button", { name: "Some seats" });
  await expect(tap).toBeVisible();
  expect((await tap.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await tap.click();
  const reading = row.locator(".venueOccupancyReading");
  await expect(reading).toHaveText("Thanks - Some seats, just now");
  // Only the receipt is announced; the ticking age never is.
  await expect(row.locator('[role="status"]')).toHaveText(
    "Thanks - Some seats, just now",
  );

  // The receipt gives way to the derived reading rather than freezing the row
  // on its own "just now" for the life of the sheet.
  await expect(reading).toHaveText("Some seats · just now · 1 person", {
    timeout: 20_000,
  });
  await expect(row.locator('[role="status"]')).toHaveText("");

  aged = true;
  await page.locator("#venueTab-story").click();
  await expect(page.locator("#venuePanel-story")).toBeVisible();
  await page.locator("#venueTab-overview").click();
  await expect(row.getByText("Some seats · 12 min ago · 1 person")).toBeVisible();
});
