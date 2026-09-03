import { expect, test, type Page } from "@playwright/test";

// Social Launch WP5 dress rehearsal (opt-in). Export both:
//   PW_SOCIAL_OPEN=1 PUBMAX_SOCIAL_FRIENDS_LAUNCH=1 npx playwright test e2e/social-open.spec.ts
//
// The flag-on server must match the launch switch; browser route doubles stand in
// for Supabase auth while the real /api/social/access route stays dark in the
// default chromium project. This rehearses the captain demo: sign in, claim a
// handle, pass the adult date-of-birth gate, land in verified Social, and prove
// friends-only posts stay invisible to a non-mutual third account.

const VIEWPORT = { width: 390, height: 844 };
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const MUTUAL_USER_ID = "00000000-0000-4000-8000-000000000002";
const STRANGER_USER_ID = "00000000-0000-4000-8000-000000000003";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const FRIENDS_POST_ID = "11111111-1111-4111-8111-111111111111";
// 43 url-safe characters, the exact shape parseDraftScope accepts.
const DRAFT_SCOPE = "abcdefghijklmnopqrstuvwxyz0123456789abcdefg";

const friendsOnlyPost = {
  id: FRIENDS_POST_ID,
  kind: "standard",
  visibility: "friends",
  body: "Friends-only rehearsal pint",
  area: "camden",
  venueId: null,
  venueName: null,
  hashtags: [],
  commentPolicy: "open",
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 0,
  editedAt: null,
  createdAt: "2026-08-05T19:00:00.000Z",
  updatedAt: "2026-08-05T19:00:00.000Z",
  ownedByViewer: false,
  author: { handle: "night_owl" },
};

type SocialAccessMock = {
  state: "sign_in_required" | "age_verification_required" | "verified";
  handle: string | null;
  /** The account has neither a stored date of birth nor a recorded assertion. */
  adultPrompt?: boolean;
};

async function seedSession(page: Page, userId: string, email: string): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId: uid, email: userEmail }) => {
    window.localStorage.setItem(
      authStorageKey,
      JSON.stringify({
        access_token: `pubmaxx-e2e-access-token-${uid}`,
        refresh_token: "pubmaxx-e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        expires_in: 86_400,
        token_type: "bearer",
        user: {
          id: uid,
          aud: "authenticated",
          role: "authenticated",
          email: userEmail,
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-07-29T00:00:00.000Z",
        },
      }),
    );
  }, {
    authStorageKey: E2E_AUTH_STORAGE_KEY,
    userId,
    email,
  });
}

async function installSocialOpenBoundary(
  page: Page,
  userId: string,
  access: SocialAccessMock,
  onboardingComplete: boolean,
): Promise<void> {
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: userId,
        aud: "authenticated",
        role: "authenticated",
        email: "social-open@example.test",
      }),
    });
  });
  await page.route("**/api/identity/handle/availability?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    if (route.request().method() === "POST") {
      access.state = "verified";
      access.handle = "night_owl";
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          complete: true,
          handle: "night_owl",
          dateOfBirth: "1995-03-21",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        onboardingComplete
          ? { complete: true, handle: access.handle ?? "night_owl" }
          : { complete: false },
      ),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: access.handle }),
    });
  });
  await page.route("**/api/social/access", async (route) => {
    const handle = access.handle;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        access.state === "verified" && handle
          ? {
              state: "verified",
              viewerHandle: handle,
              draftScope: DRAFT_SCOPE,
            }
          : {
              state: access.state,
              ...(access.adultPrompt ? { adultPrompt: true } : {}),
            },
      ),
    });
  });
  await page.route("**/api/identity/adult-assertion", async (route) => {
    access.adultPrompt = false;
    access.state = "verified";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assertedAt: "2026-08-10T18:00:00.000Z" }),
    });
  });
  await page.route("**/api/social/interactions?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null }),
    });
  });
}

test.describe("social open dress rehearsal", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !process.env.PW_SOCIAL_OPEN,
      "Set PW_SOCIAL_OPEN=1 and export PUBMAX_SOCIAL_FRIENDS_LAUNCH=1 for the webServer",
    );
    testInfo.setTimeout(60_000);
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("fresh sign-in claims a handle, passes adult DOB, and lands verified", async ({
    page,
  }) => {
    const access: SocialAccessMock = {
      state: "sign_in_required",
      handle: null,
    };

    await page.goto("/social");
    await expect(
      page.getByRole("heading", { name: "Sign in to use Social." }),
    ).toBeVisible();

    await seedSession(page, E2E_AUTH_USER_ID, "social-open@example.test");
    access.state = "age_verification_required";
    await installSocialOpenBoundary(page, E2E_AUTH_USER_ID, access, false);

    await page.goto("/social");
    await expect(
      page.getByRole("heading", { name: "Adult check needed for Social." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Let's get you in" }),
    ).toBeVisible();

    await page.getByLabel("Your handle").fill("night_owl");
    await page.getByLabel("Date of birth").fill("1995-03-21");
    await expect(page.getByText("Handle available.")).toBeVisible();
    await page.getByRole("button", { name: "Claim handle" }).click();

    await expect(page.getByRole("link", { name: "Posts", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New post" })).toBeVisible();
  });

  // One line and one button, at both sizes. The prompt lives in the ordinary
  // empty-state idiom, so a phone and a desktop meet the same surface.
  for (const size of [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    test(`an account with a handle and no date of birth taps its way in (${size.name})`, async ({
      page,
    }) => {
      // Captain decision 2026-08-10: everybody who joins is taken to be an adult
      // on one recorded tap. The handle is already claimed, so the only thing
      // standing between this account and Social is the age question.
      const access: SocialAccessMock = {
        state: "age_verification_required",
        handle: "night_owl",
        adultPrompt: true,
      };

      await page.setViewportSize({ width: size.width, height: size.height });
      await seedSession(page, E2E_AUTH_USER_ID, "social-open@example.test");
      await installSocialOpenBoundary(page, E2E_AUTH_USER_ID, access, true);

      await page.goto("/social");
      const prompt = page.getByRole("heading", {
        name: "Social is for over-18s.",
      });
      await expect(prompt).toBeVisible();

      const tap = page.getByRole("button", { name: "I'm 18 or over" });
      // A tap target a thumb can hit, at either size.
      const box = await tap.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      await tap.click();

      await expect(page.getByRole("button", { name: "New post" })).toBeVisible();
      await expect(prompt).toHaveCount(0);
    });
  }

  test("friends-only post is visible to a mutual and hidden from a third account", async ({
    browser,
    baseURL,
  }) => {
    const mutualContext = await browser.newContext({ baseURL });
    const strangerContext = await browser.newContext({ baseURL });

    const mutualPage = await mutualContext.newPage();
    const strangerPage = await strangerContext.newPage();

    for (const page of [mutualPage, strangerPage]) {
      await page.setViewportSize(VIEWPORT);
      await page.addInitScript(() => {
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
    }

    const mutualAccess: SocialAccessMock = {
      state: "verified",
      handle: "mutual_viewer",
    };
    const strangerAccess: SocialAccessMock = {
      state: "verified",
      handle: "stranger_viewer",
    };

    await seedSession(mutualPage, MUTUAL_USER_ID, "mutual@example.test");
    await seedSession(strangerPage, STRANGER_USER_ID, "stranger@example.test");
    await installSocialOpenBoundary(mutualPage, MUTUAL_USER_ID, mutualAccess, true);
    await installSocialOpenBoundary(strangerPage, STRANGER_USER_ID, strangerAccess, true);

    const mutualPosts = async (route: import("@playwright/test").Route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ posts: [friendsOnlyPost], nextCursor: null }),
      });
    };
    const emptyPosts = async (route: import("@playwright/test").Route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ posts: [], nextCursor: null }),
      });
    };

    await mutualPage.route("**/api/social/posts**", mutualPosts);
    await strangerPage.route("**/api/social/posts**", emptyPosts);

    await mutualPage.goto("/social");
    await expect(mutualPage.getByText("Friends-only rehearsal pint")).toBeVisible();

    await strangerPage.goto("/social");
    await expect(strangerPage.getByText("Friends-only rehearsal pint")).toHaveCount(0);

    await mutualContext.close();
    await strangerContext.close();
  });
});
