import { expect, test, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000031";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const HANDLE = "night_owl";

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function installOwnProfile(page: Page): Promise<void> {
  await page.addInitScript(
    ({ authStorageKey, userId, handle }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
      window.localStorage.setItem("pubmax_handle", handle);
      window.localStorage.setItem("pubmax_account_owner", userId);
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
            email: "price-impact-e2e@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-08-16T00:00:00.000Z",
          },
        }),
      );
    },
    {
      authStorageKey: E2E_AUTH_STORAGE_KEY,
      userId: E2E_AUTH_USER_ID,
      handle: HANDLE,
    },
  );

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "price-impact-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: true, handle: HANDLE }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer pubmaxx-e2e-access-token",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: HANDLE }),
    });
  });
  await page.route("**/api/profiles/night_owl/lane-stats", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stats: {
          status: "ready",
          handle: HANDLE,
          prices: 2,
          reviews: 0,
          recommendations: 0,
          total: 2,
        },
      }),
    });
  });
  await page.route("**/api/price-impact", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer pubmaxx-e2e-access-token",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        observationsLogged: 2,
        pricesTrustedNow: 1,
        lifetimeTrustUnlocks: 1,
      }),
    });
  });
}

test.use({ viewport: VIEWPORT, serviceWorkers: "block" });
test.describe.configure({ mode: "default" });
test.setTimeout(60_000);

test("the personal contributions card shows three separate trust measures", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const analyticsPayloads: Array<{ name?: unknown; props?: unknown }> = [];
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) analyticsPayloads.push(JSON.parse(raw));
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  await installOwnProfile(page);

  const response = await page.goto(`/u/${HANDLE}#contribution-impact`);
  expect(response?.status()).toBe(200);

  const impact = page.locator("#contribution-impact");
  await expect(impact).toBeVisible({ timeout: 20_000 });
  const trust = impact.locator("[data-testid='price-trust-impact']");
  await expect(trust).toBeVisible();
  await expect(trust.getByText("2")).toBeVisible();
  await expect(trust.getByText("observations logged")).toBeVisible();
  await expect(trust.getByText("1")).toHaveCount(2);
  await expect(trust.getByText("price trusted now")).toBeVisible();
  await expect(trust.getByText("lifetime trust unlock")).toBeVisible();
  await expect(impact.getByText("price trust record right now.")).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    VIEWPORT.width,
  );
  expect(errors).toEqual([]);

  await expect.poll(() =>
    analyticsPayloads
      .filter((payload) => payload.name === "mission_impact_opened")
      .map(({ name, props }) => ({ name, props })),
  ).toEqual([{ name: "mission_impact_opened", props: { surface: "profile" } }]);
});
