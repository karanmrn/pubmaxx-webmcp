import { expect, test, type Page } from "@playwright/test";

// The account surface as a social identity card: the nav menu names the person
// and where they go, the public profile carries their own linked handles, and
// the editor adds and removes them.
//
// The keyless Playwright server has no Supabase, so the session and the two
// owner-only reads are browser route doubles. Everything under test - the card,
// the links, the editor rows and the copy - is the real shipped UI.

const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-00000000000b";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const HANDLE = "socialproof";

type Connection = {
  provider: string;
  mode: string;
  accountKind: string;
  status: string;
  username: string;
  profileUrl: string;
  scopes: string[];
  connectedAt: string;
  updatedAt: string;
};

const LINKS: Array<{ provider: string; label: string; mark: string; username: string; profileUrl: string }> = [
  { provider: "x", label: "X", mark: "X", username: "socialproof", profileUrl: "https://x.com/socialproof" },
  { provider: "instagram", label: "Instagram", mark: "IG", username: "social.proof", profileUrl: "https://www.instagram.com/social.proof/" },
  { provider: "letterboxd", label: "Letterboxd", mark: "LB", username: "socialproof", profileUrl: "https://letterboxd.com/socialproof/" },
  { provider: "spotify", label: "Spotify", mark: "SP", username: "socialproof", profileUrl: "https://open.spotify.com/user/socialproof" },
  { provider: "website", label: "Website", mark: "WW", username: "socialproof.co.uk", profileUrl: "https://socialproof.co.uk/" },
];

function connections(): Connection[] {
  return LINKS.map((link) => ({
    provider: link.provider,
    mode: "manual",
    accountKind: "personal",
    status: "connected",
    username: link.username,
    profileUrl: link.profileUrl,
    scopes: [],
    connectedAt: "2026-08-01T18:00:00.000Z",
    updatedAt: "2026-08-01T18:00:00.000Z",
  }));
}

async function installSignedInOwner(page: Page): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId }) => {
    window.localStorage.setItem("pubmax_handle", "socialproof");
    // A completed sign-in stamps whose device this is (lib/deviceAccountIdentity.ts).
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
          email: "a.rather.long.address@example.test",
          app_metadata: {},
          user_metadata: { full_name: "Night Owl" },
          created_at: "2026-07-29T00:00:00.000Z",
        },
      }),
    );
  }, { authStorageKey: E2E_AUTH_STORAGE_KEY, userId: E2E_AUTH_USER_ID });

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "a.rather.long.address@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: true, handle: HANDLE, dateOfBirth: "1995-06-15" }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: HANDLE }),
    });
  });
  await page.route("**/api/social-connections", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: connections(),
        providers: Object.fromEntries(
          ["x", "instagram", "tiktok", "youtube", "letterboxd", "spotify", "snapchat", "strava", "linkedin", "website"]
            .map((provider) => [provider, { oauth: false, manual: true }]),
        ),
      }),
    });
  });
  await page.route(`**/api/profiles/${HANDLE}*`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          handle: HANDLE,
          displayName: "Night Owl",
          homeCity: "London",
          bio: "Cask first, cocktails after. Usually somewhere with a fire.",
          createdAt: "2026-07-29T00:00:00.000Z",
          updatedAt: "2026-08-01T18:00:00.000Z",
        },
        socialLinks: LINKS,
        counts: { followers: 42, following: 18 },
        viewerFollowing: false,
      }),
    });
  });
}

test.describe("social identity card", () => {
  test("desktop nav account menu names the person and where they go", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSignedInOwner(page);

    await page.goto("/pint-index");
    const trigger = page.getByRole("button", { name: /Account options for/ });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.locator(".authAccountMenu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Night Owl", { exact: true })).toBeVisible();
    await expect(menu.getByText(`@${HANDLE}`)).toBeVisible();
    await expect(menu.getByRole("link", { name: "Your profile" })).toHaveAttribute(
      "href",
      `/u/${HANDLE}`,
    );
    await expect(menu.getByRole("link", { name: "Your Wanteds" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Edit profile" })).toBeVisible();
    await expect(menu.getByText("a.rather.long.address@example.test")).toBeVisible();
    await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();

    // The popover rises on open; let it settle so the shot is the resting card.
    await page.waitForTimeout(400);
    await page.screenshot({ path: "/tmp/pubmax-account-menu-1440.png" });
  });

  test("public profile carries the owner's own links, safely", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await installSignedInOwner(page);

    await page.goto(`/u/${HANDLE}`);
    const socials = page.locator(".profileSocials");
    await expect(socials).toBeVisible();
    for (const link of LINKS) {
      const anchor = socials.locator(`a[href="${link.profileUrl}"]`);
      await expect(anchor).toBeVisible();
      await expect(anchor).toHaveAttribute("rel", "me noopener noreferrer");
      await expect(anchor).toHaveAttribute("target", "_blank");
    }

    await page.screenshot({ path: "/tmp/pubmax-profile-socials-1440.png", fullPage: false });
  });

  test("phone profile keeps the links and the editor readable at 390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installSignedInOwner(page);

    await page.goto(`/u/${HANDLE}`);
    await expect(page.locator(".profileSocials")).toBeVisible();
    await page.screenshot({ path: "/tmp/pubmax-profile-socials-390.png" });

    await page.getByRole("button", { name: "Edit profile" }).click();
    const editor = page.locator(".socialLinks");
    await expect(editor.getByRole("heading", { name: "Link your socials" })).toBeVisible();
    await expect(
      editor.getByText("Add the accounts you want people to find you on."),
    ).toBeVisible();
    await expect(editor.getByRole("button", { name: "Remove Instagram" })).toBeVisible();
    await editor.scrollIntoViewIfNeeded();

    // The row must never scroll the page sideways on a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({ path: "/tmp/pubmax-social-editor-390.png" });
  });
});
