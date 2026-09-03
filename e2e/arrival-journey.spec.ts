import { expect, test, type Page } from "@playwright/test";

// Arrival is the moment of togetherness, never an admin form.
//
// DEFECT ZERO: an account that already owns a handle but never stored a date of
// birth (claimed through POST /api/identity/handle/claim, which takes no date of
// birth) reads back from GET /api/identity/onboarding as
// `{ complete: false, handle: "karan" }`. AccountOnboarding used to answer that
// with a blocking owned-identity dialog carrying a rename field, mounted at the
// app root inside AuthProvider, so it covered every tab and only a React-local
// flag ever dismissed it.
//
// The keyless Playwright server has no Supabase, so the session and the
// owner-only reads are browser route doubles, and a completed sign-in is
// reproduced by the state one leaves behind (the tab's arrival marker plus the
// remembered door). Every surface under test is the real shipped UI.

const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-0000000000a1";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const HANDLE = "karan";
const SHOTS = "/tmp/pubmax-arrival";

type OnboardingBody = { complete: boolean; handle?: string; dateOfBirth?: string };

type SessionOptions = {
  /** Reproduce the state a completed sign-in leaves in the landing tab. */
  arrival?: "signin" | "signup";
  deviceHandle?: string;
};

async function installSession(
  page: Page,
  onboarding: OnboardingBody,
  options: SessionOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({ authStorageKey, userId, deviceHandle, arrival }) => {
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      if (deviceHandle) {
        window.localStorage.setItem("pubmax_handle", deviceHandle);
        // A completed sign-in stamps whose device this is; without it the
        // account boundary treats the cached handle as the previous person's
        // and clears it (lib/deviceAccountIdentity.ts).
        window.localStorage.setItem("pubmax_account_owner", userId);
      }
      if (arrival) {
        window.sessionStorage.setItem(
          "pubmax:arrival-welcome:v1",
          JSON.stringify({ intent: arrival, at: Date.now() }),
        );
      }
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
            email: "founder@example.test",
            app_metadata: {},
            user_metadata: { full_name: "Karan" },
            created_at: "2026-07-29T00:00:00.000Z",
          },
        }),
      );
    },
    {
      authStorageKey: E2E_AUTH_STORAGE_KEY,
      userId: E2E_AUTH_USER_ID,
      deviceHandle: options.deviceHandle ?? "",
      arrival: options.arrival ?? "",
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
        email: "founder@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(onboarding),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: onboarding.handle ?? null }),
    });
  });
}

function identityDialog(page: Page) {
  return page.locator(".accountOnboardingBackdrop");
}

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
});

test.describe("returning drinker", () => {
  test("arrives with no identity sheet, on any tab", async ({ page }) => {
    // The founder's exact account: a claimed handle, no stored date of birth.
    await installSession(page, { complete: false, handle: HANDLE });

    await page.goto("/today");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/returning-1-today.png` });

    await expect(identityDialog(page)).toHaveCount(0);
    await expect(page.getByText("Rename handle")).toHaveCount(0);

    // The original report: "the same tab keeps opening everywhere". Walk the
    // tabs the way a phone does, through the bottom bar, not a fresh load.
    for (const tab of ["Map", "Plan", "You"]) {
      const link = page.getByRole("link", { name: tab, exact: true }).first();
      if ((await link.count()) === 0) continue;
      await link.click();
      await page.waitForTimeout(1200);
      await expect(identityDialog(page)).toHaveCount(0);
    }
    await page.screenshot({ path: `${SHOTS}/returning-2-after-tabs.png` });

    // A hard reload discarded the old React-only dismissal. It must stay quiet.
    await page.reload();
    await page.waitForTimeout(2500);
    await expect(identityDialog(page)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/returning-3-after-reload.png` });
  });

  test("is welcomed back by name, then left alone", async ({ page }) => {
    await installSession(
      page,
      { complete: false, handle: HANDLE },
      { arrival: "signin", deviceHandle: HANDLE },
    );

    await page.goto("/today");
    const welcome = page.getByText(`Welcome back, @${HANDLE}.`);
    await expect(welcome).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/returning-4-welcome-back.png` });

    // A greeting, not a gate: no dialog, and it retires itself.
    await expect(identityDialog(page)).toHaveCount(0);
    await expect(welcome).toBeHidden({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/returning-5-welcome-gone.png` });
  });

  test("is greeted once, not again on the next page", async ({ page }) => {
    await installSession(
      page,
      { complete: false, handle: HANDLE },
      { arrival: "signin", deviceHandle: HANDLE },
    );
    await page.goto("/today");
    await expect(page.getByText(`Welcome back, @${HANDLE}.`)).toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/map");
    await page.waitForTimeout(3000);
    await expect(page.getByText(`Welcome back, @${HANDLE}.`)).toHaveCount(0);
  });
});

test.describe("first-timer", () => {
  test("meets a welcome, then one step, never a form pile", async ({ page }) => {
    // A brand-new account: signed in, no handle yet.
    await installSession(page, { complete: false });

    await page.goto("/today");
    const sheet = page.locator(".accountOnboarding").first();
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/first-timer-1-welcome.png` });

    // Beat one is the place. Beat two is the only thing it cannot start without.
    await expect(sheet.getByText("Welcome to PUBMAXX")).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: "Let's get you in" }),
    ).toBeVisible();
    await expect(sheet.getByText("Your handle", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Date of birth", { exact: true })).toBeVisible();

    // One action, and nothing that offers to skip what was never demanded.
    await expect(sheet.getByRole("button")).toHaveCount(1);
    await expect(sheet.getByText("Skip optional details")).toHaveCount(0);
    await expect(sheet.locator("select")).toHaveCount(0);

    await sheet.locator('input[autocomplete="username"]').fill("newdrinker");
    await sheet.locator('input[type="date"]').fill("1996-04-11");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/first-timer-2-filled.png` });
  });
});

test.describe("the two doors", () => {
  test("sign in and new here read differently on /login", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });

    await page.goto("/login?from=%2Fmap");
    await expect(
      page.getByRole("heading", { name: "Sign in or create your account", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sign in" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.screenshot({ path: `${SHOTS}/doors-1-signin.png` });

    await page.getByRole("tab", { name: "New here" }).click();
    await expect(
      page.getByRole("heading", { name: "Let's get you in", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/mode=signup/);
    await page.screenshot({ path: `${SHOTS}/doors-2-signup.png` });

    // A direct link opens the right door on first paint.
    await page.goto("/login?mode=signup");
    await expect(page.getByRole("tab", { name: "New here" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
