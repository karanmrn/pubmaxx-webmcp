import { expect, test, type Page } from "@playwright/test";

// Founding members: a mark, a wall, and one door.
//
// The rule under test is the asymmetric half. A founding member is shown their
// number and the founders' room. A person who is not one is shown NOTHING: no
// greyed link, no "you missed it" line, no counter. So most of these cases are
// negative, and the honest way to run them is on the real shipped UI with a
// signed-in session rather than on a component in isolation.
//
// The keyless Playwright server has no Supabase, so the session and the
// owner-only reads are browser route doubles, exactly as e2e/arrival-journey
// does it. What that CANNOT double is the server-rendered /founders wall, so
// the wall cases below assert its empty state, which is the state a keyless
// build genuinely has and which must still read as a page rather than a gap.
// The populated wall is proven against the real page component in
// __tests__/foundingMembersWall.test.ts.

const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-0000000000f1";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const HANDLE = "early_bird";
const SHOTS = "/tmp/pubmax-founding-members";
const DISCORD_HOST = "discord.gg";

type SessionOptions = {
  /** The number the live session reports, or null for an ordinary account. */
  foundingMemberNumber: number | null;
  /** Reproduce the state a completed sign-in leaves in the landing tab. */
  arrival?: "signin" | "signup";
};

async function installSession(page: Page, options: SessionOptions): Promise<void> {
  await page.addInitScript(
    ({ authStorageKey, userId, handle, arrival }) => {
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.setItem("pubmax_handle", handle);
      // A completed sign-in stamps whose device this is; without it the account
      // boundary treats the cached handle as the previous person's and clears
      // it (lib/deviceAccountIdentity.ts).
      window.localStorage.setItem("pubmax_account_owner", userId);
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
            user_metadata: { full_name: "Early Bird" },
            created_at: "2026-07-29T00:00:00.000Z",
          },
        }),
      );
    },
    {
      authStorageKey: E2E_AUTH_STORAGE_KEY,
      userId: E2E_AUTH_USER_ID,
      handle: HANDLE,
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
      body: JSON.stringify({ complete: true, handle: HANDLE, dateOfBirth: "1990-01-01" }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handle: HANDLE,
        foundingMemberNumber: options.foundingMemberNumber,
      }),
    });
  });
}

function discordLink(page: Page) {
  return page.locator(`a[href*="${DISCORD_HOST}"]`);
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("a founding member", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("meets the founders' door once on arrival, and never again", async ({ page }) => {
    await installSession(page, { foundingMemberNumber: 7, arrival: "signin" });

    await page.goto("/today");
    await expect(page.getByText(`Welcome back, @${HANDLE}.`)).toBeVisible({
      timeout: 10_000,
    });
    const door = discordLink(page).first();
    await expect(door).toBeVisible({ timeout: 10_000 });
    await expect(door).toHaveAttribute("target", "_blank");
    await expect(door).toHaveAttribute("rel", /noopener/);
    await page.screenshot({ path: `${SHOTS}/phone-1-arrival-door.png` });

    // The greeting is a courtesy, not a gate: it retires itself.
    await expect(door).toBeHidden({ timeout: 20_000 });

    // Once ever. A second arrival on the same browser is greeted, and that is
    // all: the door does not come back.
    await page.goto("/map");
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        "pubmax:arrival-welcome:v1",
        JSON.stringify({ intent: "signin", at: Date.now() }),
      );
    });
    await page.goto("/today");
    await expect(page.getByText(`Welcome back, @${HANDLE}.`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(discordLink(page)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/phone-2-second-arrival-no-door.png` });
  });

  test("carries the mark and the door on You", async ({ page }) => {
    await installSession(page, { foundingMemberNumber: 7 });

    await page.goto("/u/you");
    await page.waitForLoadState("domcontentloaded");
    // The account's own card. The mark on the PUBLIC profile card comes from
    // the stored profile row instead, which a keyless server does not hold, so
    // that half is proven in __tests__/foundingMemberRender.test.ts.
    const card = page.locator(".accountHubFounding");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("Founding member · No. 7")).toBeVisible();
    await expect(discordLink(page).first()).toBeVisible({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${SHOTS}/phone-3-you-founding-card.png` });
    await page.screenshot({ path: `${SHOTS}/phone-3b-you-full.png`, fullPage: true });

    // The page never scrolls sideways at 390 because of the mark.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("an ordinary account", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("is shown no founding surface anywhere", async ({ page }) => {
    await installSession(page, { foundingMemberNumber: null, arrival: "signin" });

    await page.goto("/today");
    await expect(page.getByText(`Welcome back, @${HANDLE}.`)).toBeVisible({
      timeout: 10_000,
    });
    // No door, and nothing telling them what they missed.
    await expect(discordLink(page)).toHaveCount(0);
    await expect(page.getByText(/Founding member/i)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/phone-4-ordinary-arrival.png` });

    await page.goto("/u/you");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2_500);
    await expect(discordLink(page)).toHaveCount(0);
    await expect(page.getByText(/Founding member/i)).toHaveCount(0);
    await expect(page.getByText(/Discord/i)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/phone-5-ordinary-you.png`, fullPage: true });
  });
});

test.describe("the founders wall", () => {
  test("reads as a page at phone width, and offers no way in", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/founders");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: "The first hundred" })).toBeVisible();
    await expect(page.getByText(/no perks/i)).toBeVisible();
    // A keyless server has no claimed handles, so this is the empty state. It
    // must still be a sentence, never a blank panel.
    await expect(page.getByText(/Nobody has claimed a handle yet/i)).toBeVisible();
    await expect(discordLink(page)).toHaveCount(0);
    await expect(page.getByText(/claim yours|hurry|last chance/i)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/phone-6-wall.png`, fullPage: true });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("reads as a page on the desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/founders");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: "The first hundred" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/desktop-1-wall.png`, fullPage: true });
  });
});
