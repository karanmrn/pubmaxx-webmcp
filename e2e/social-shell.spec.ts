import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const post = (id: string, body: string, createdAt: string) => ({
  id,
  kind: "standard",
  visibility: "public",
  body,
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
  createdAt,
  updatedAt: createdAt,
  ownedByViewer: false,
  author: { handle: "night_owl" },
});

const longFeaturePost = {
  ...post(
    "long-feature",
    "A detailed feature request for planning a whole pub night without losing the next stop, the chosen area, or the last-train decision when this post wraps across several lines on a narrow phone.",
    "2026-08-05T19:00:00.000Z",
  ),
  kind: "feature_request",
  visibility: "friends",
  venueId: "venue-proof-long",
  hashtags: ["accessiblepubnights", "camdenafterdark", "lasttrainplanning"],
  featureRequest: { status: "submitted" },
  author: { handle: "a_very_long_pub_night_handle_that_must_wrap" },
};

// Social posts and access are account-owned. Keep the shell tests on the
// authenticated contract they exercise instead of relying on a browser that
// happens to retain a session from another spec. This is the same provider-
// shaped session used by the flag-on Social rehearsal; no real account exists.
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000010";

async function seedSocialSession(page: Page): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId }) => {
    window.localStorage.setItem(
      authStorageKey,
      JSON.stringify({
        access_token: `pubmaxx-e2e-access-token-${userId}`,
        refresh_token: "pubmaxx-e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        expires_in: 86_400,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "social-shell@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-07-29T00:00:00.000Z",
        },
      }),
    );
  }, { authStorageKey: E2E_AUTH_STORAGE_KEY, userId: E2E_AUTH_USER_ID });
}

async function mockCanonicalIdentity(page: Page): Promise<void> {
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ handle: "night_owl" }),
    });
  });
}

async function mockAccess(
  page: Page,
  state: string,
  status = 200,
): Promise<void> {
  await page.route("**/api/social/access", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        state === "verified"
          ? {
              state,
              viewerHandle: "night_owl",
              draftScope: "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijk",
            }
          : { state },
      ),
    });
  });
}

async function mockActivity(page: Page, items: unknown[] = []): Promise<void> {
  await page.route("**/api/social/interactions?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items, nextCursor: null }),
    });
  });
}

async function fulfil(
  route: Route,
  posts: unknown[],
  nextCursor: string | null = null,
) {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ posts, nextCursor }),
  });
}

test.beforeEach(async ({ page }) => {
  await seedSocialSession(page);
  await mockCanonicalIdentity(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("preview shows one safe boundary and never requests or leaks protected posts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAccess(page, "preview");
  let postReads = 0;
  let activityReads = 0;
  await page.route("**/api/social/posts**", async (route) => {
    postReads += 1;
    await fulfil(route, [
      post("protected", "Protected words", "2026-08-05T19:00:00.000Z"),
    ]);
  });
  await page.route("**/api/social/interactions?**", async (route) => {
    activityReads += 1;
    await route.abort();
  });

  const response = await page.goto("/social");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Social preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Social preview is invite-only for now. It opens more widely soon." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Posts", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Protected words")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Following" })).toHaveCount(0);
  expect(postReads).toBe(0);
  expect(activityReads).toBe(0);

  const landmarks = await page.locator("main").count();
  const h1s = await page.locator("h1").count();
  expect({ landmarks, h1s }).toEqual({ landmarks: 1, h1s: 1 });
  await expect(
    page.locator('main nav[aria-label="Site navigation"]'),
  ).toHaveCount(0);
});

test("invalid public post DTO cannot render exact Venue context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAccess(page, "verified");
  await mockActivity(page);
  await page.route("**/api/social/posts**", async (route) => {
    await fulfil(route, [
      {
        ...post(
          "invalid-public-venue",
          "Public area context remains visible",
          "2026-08-05T19:00:00.000Z",
        ),
        venueId: "venue-must-not-render",
      },
    ]);
  });

  await page.goto("/social");
  await expect(
    page.getByText("Public area context remains visible"),
  ).toBeVisible();
  await expect(page.getByText("Camden", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open venue" })).toHaveCount(0);
  await expect(page.locator('a[href*="venue-must-not-render"]')).toHaveCount(0);
});

test("verified lanes stay chronological, wait for Nearby area, paginate explicitly, and keep cursor out of URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAccess(page, "verified");
  await mockActivity(page);
  const requests: string[] = [];
  await page.route("**/api/social/posts**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}?${url.searchParams.toString()}`);
    const lane = url.searchParams.get("lane");
    const cursor = url.searchParams.get("cursor");
    if (lane === "following" && cursor === null) {
      await fulfil(
        route,
        [
          post("newer", "Newest first", "2026-08-05T19:00:00.000Z"),
          post("older", "Older second", "2026-08-05T18:00:00.000Z"),
        ],
        "viewer-bound-page-2",
      );
      return;
    }
    if (cursor === "viewer-bound-page-2") {
      await fulfil(route, [
        post("oldest", "Oldest loaded", "2026-08-05T17:00:00.000Z"),
      ]);
      return;
    }
    await fulfil(route, [
      post(`${lane}-1`, `${lane} lane`, "2026-08-05T16:00:00.000Z"),
    ]);
  });

  await page.goto("/social");
  await expect(page.locator(".socialPostCard")).toHaveCount(2);
  await expect(
    page.locator(".socialPostBody").allTextContents(),
  ).resolves.toEqual(["Newest first", "Older second"]);
  await page.screenshot({
    path: "/tmp/social-wp1-verified-feed-390.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.locator(".socialPostCard")).toHaveCount(3);
  expect(page.url()).not.toContain("cursor");

  const beforeNearby = requests.length;
  await page.getByRole("link", { name: "Nearby", exact: true }).click();
  await expect(page).toHaveURL(/\/social\?feed=nearby$/);
  await expect(page.getByLabel("Nearby area")).toBeVisible();
  expect(requests).toHaveLength(beforeNearby);

  await page.getByLabel("Nearby area").selectOption("camden");
  await expect(page).toHaveURL(/feed=nearby&area=camden/);
  await expect(page.getByText("nearby lane")).toBeVisible();
  expect(requests.at(-1)).toContain("lane=nearby&area=camden");
});

test("Nearby area survives refresh and browser Back restores its exact URL state", async ({
  page,
}) => {
  await mockAccess(page, "verified");
  await mockActivity(page);
  await page.route("**/api/social/posts**", async (route) => {
    const lane = new URL(route.request().url()).searchParams.get("lane");
    await fulfil(route, [
      post(`${lane}-post`, `${lane} restored`, "2026-08-05T19:00:00.000Z"),
    ]);
  });

  await page.goto("/social?feed=nearby&area=camden");
  await expect(page.getByLabel("Nearby area")).toHaveValue("camden");
  await expect(page.getByLabel("Nearby area")).toHaveAttribute(
    "autocomplete",
    "off",
  );
  await expect(page.getByText("nearby restored")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/social\?feed=nearby&area=camden$/);
  await expect(page.getByLabel("Nearby area")).toHaveValue("camden");
  await expect(page.getByText("nearby restored")).toBeVisible();

  await page.getByRole("link", { name: "Across town", exact: true }).click();
  await expect(page).toHaveURL(/\/social\?feed=discover$/);
  await expect(page.getByText("discover restored")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/social\?feed=nearby&area=camden$/);
  await expect(page.getByLabel("Nearby area")).toHaveValue("camden");
  await expect(page.getByText("nearby restored")).toBeVisible();
});

test("stale lane responses cannot replace the active Across town lane", async ({
  page,
}) => {
  await mockAccess(page, "verified");
  await mockActivity(page);
  let releaseFollowing: (() => void) | undefined;
  await page.route("**/api/social/posts**", async (route) => {
    const lane = new URL(route.request().url()).searchParams.get("lane");
    if (lane === "following") {
      await new Promise<void>((resolve) => {
        releaseFollowing = resolve;
      });
      await fulfil(route, [
        post("stale", "Stale following", "2026-08-05T19:00:00.000Z"),
      ]);
      return;
    }
    await fulfil(route, [
      post("current", "Across town current", "2026-08-05T19:00:00.000Z"),
    ]);
  });

  await page.goto("/social");
  await page.getByRole("link", { name: "Across town", exact: true }).click();
  await expect(page).toHaveURL(/feed=discover/);
  await expect(page.getByText("Across town current")).toBeVisible();
  releaseFollowing?.();
  await page.waitForTimeout(100);
  await expect(page.getByText("Stale following")).toHaveCount(0);
});

test("public discovery embeds one body and passes keyboard and axe checks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  let accessReads = 0;
  await page.route("**/api/social/access", async (route) => {
    accessReads += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ state: "preview" }),
    });
  });
  await page.goto("/social?tab=discover");

  await expect(
    page.getByRole("heading", { name: "Choose your drink" }),
  ).toBeVisible();
  expect(await page.locator("main").count()).toBe(1);
  expect(await page.locator("h1").count()).toBe(1);
  expect(
    await page.getByRole("navigation", { name: "Site navigation" }).count(),
  ).toBe(1);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();

  const results = await new AxeBuilder({ page }).include("main").analyze();
  expect(results.violations).toEqual([]);
  expect(accessReads).toBe(0);

  if (process.env.PW_SOCIAL_PROOF === "1") {
    const proofDirectory = join(process.cwd(), "docs", "proof", "social-shell");
    mkdirSync(proofDirectory, { recursive: true });
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    await page.screenshot({
      path: join(proofDirectory, "1280-discover-dark.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    await page.screenshot({
      path: join(proofDirectory, "390-discover-dark.png"),
      fullPage: false,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const discoverControls = page.locator(
    ".socialDiscoverBody a:visible, .socialDiscoverBody button:visible, .socialDiscoverBody select:visible",
  );
  const controlCount = await discoverControls.count();
  expect(controlCount).toBeGreaterThan(3);
  for (const [name, control] of [
    ["middle", discoverControls.nth(Math.floor(controlCount / 2))],
    ["end", discoverControls.nth(controlCount - 1)],
  ] as const) {
    await control.focus();
    await control.evaluate((element) =>
      element.scrollIntoView({ block: "end" }),
    );
    const [controlBox, navBox] = await Promise.all([
      control.boundingBox(),
      page.getByRole("navigation", { name: "Primary" }).boundingBox(),
    ]);
    expect(controlBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(
      (controlBox?.y ?? 0) + (controlBox?.height ?? 0),
      name,
    ).toBeLessThanOrEqual((navBox?.y ?? 0) - 8);
    if (process.env.PW_SOCIAL_PROOF === "1") {
      await page.screenshot({
        path: join(
          process.cwd(),
          "docs",
          "proof",
          "social-shell",
          `390-discover-dark-focus-${name}.png`,
        ),
        fullPage: false,
      });
    }
  }

  if (process.env.PW_SOCIAL_PROOF === "1") {
    for (const target of [
      { width: 320, height: 760, theme: "light" },
      { width: 430, height: 932, theme: "dark" },
      { width: 1440, height: 1000, theme: "light" },
    ] as const) {
      await page.setViewportSize({
        width: target.width,
        height: target.height,
      });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        window.localStorage.setItem("pubmax-theme", theme);
        window.scrollTo(0, 0);
        (document.activeElement as HTMLElement | null)?.blur();
      }, target.theme);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(target.width);
      await page.screenshot({
        path: join(
          process.cwd(),
          "docs",
          "proof",
          "social-shell",
          `${target.width}-discover-${target.theme}.png`,
        ),
        fullPage: false,
      });
    }
  }
});

test("feed retry repeats only the failed chronological read", async ({
  page,
}) => {
  let accessReads = 0;
  await page.route("**/api/social/access", async (route) => {
    accessReads += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ state: "verified" }),
    });
  });
  let feedReads = 0;
  await mockActivity(page);
  await page.route("**/api/social/posts**", async (route) => {
    feedReads += 1;
    if (feedReads === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "SOCIAL_POSTS_UNAVAILABLE" }),
      });
      return;
    }
    await fulfil(route, [
      post("recovered", "Back in order", "2026-08-05T19:00:00.000Z"),
    ]);
  });

  await page.goto("/social");
  await expect(
    page.getByRole("heading", {
      name: "Social preview posts are unavailable right now.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Back in order")).toBeVisible();
  expect(feedReads).toBe(2);
  expect(accessReads).toBe(1);
});

test("verified Activity rail shows reauthorised generic notifications only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockAccess(page, "verified");
  await page.route("**/api/social/posts**", async (route) => {
    await fulfil(route, [
      post("post-a", "Visible post", "2026-08-05T19:00:00.000Z"),
    ]);
  });
  let activityReads = 0;
  await page.route("**/api/social/interactions?**", async (route) => {
    activityReads += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            kind: "comment",
            sourcePostId: "22222222-2222-4222-8222-222222222222",
            readAt: null,
            createdAt: "2026-08-05T19:00:00.000Z",
            protectedText: "must never render",
          },
        ],
        nextCursor: null,
      }),
    });
  });

  await page.goto("/social");
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("New comment")).toBeVisible();
  await expect(page.getByText("must never render")).toHaveCount(0);
  await expect(
    page.getByText("22222222-2222-4222-8222-222222222222"),
  ).toHaveCount(0);
  await expect(
    page.locator('.socialContextRail a[href="/activity"]'),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Activity" })).toHaveCount(
    0,
  );
  expect(activityReads).toBe(1);
});

test("retired route families redirect directly to canonical Social", async ({
  request,
}) => {
  for (const [source, destination] of [
    ["/feed/nested", "/social"],
    ["/stories/nested", "/social"],
    ["/discover/nested", "/social?tab=discover"],
    ["/drinks/nested", "/social?tab=discover"],
  ] as const) {
    const response = await request.get(source, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    const location = new URL(response.headers().location, "http://localhost");
    expect(`${location.pathname}${location.search}`).toBe(destination);
  }
});

test("invalid Social URL state resolves to the safe canonical route", async ({
  page,
}) => {
  await mockAccess(page, "preview");
  await page.goto("/social?cursor=viewer-secret&feed=nearby&area=unknown");
  await expect(page).toHaveURL(/\/social$/);
  expect(page.url()).not.toContain("cursor");
  await expect(
    page.getByRole("heading", { name: "Social preview is invite-only for now. It opens more widely soon." }),
  ).toBeVisible();
});

test("Social shell fits target viewports in light and dark themes", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const proofDirectory = join(process.cwd(), "docs", "proof", "social-shell");
  const saveProof = process.env.PW_SOCIAL_PROOF === "1";
  if (saveProof) mkdirSync(proofDirectory, { recursive: true });

  const targets = [
    { width: 320, height: 760, mode: "mobile" },
    { width: 390, height: 844, mode: "mobile" },
    { width: 430, height: 932, mode: "mobile" },
    { width: 1280, height: 900, mode: "desktop" },
    { width: 1440, height: 1000, mode: "desktop" },
  ] as const;

  for (const target of targets) {
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: target.width, height: target.height },
        colorScheme: theme,
      });
      const page = await context.newPage();
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem("pubmax-theme", selectedTheme);
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      }, theme);
      await seedSocialSession(page);
      await mockCanonicalIdentity(page);
      await mockAccess(page, "verified");
      await mockActivity(page, [
        {
          id: "33333333-3333-4333-8333-333333333333",
          kind: "comment",
          sourcePostId: "44444444-4444-4444-8444-444444444444",
          readAt: null,
          createdAt: "2026-08-05T19:00:00.000Z",
        },
      ]);
      await page.route("**/api/social/posts**", async (route) => {
        const lane = new URL(route.request().url()).searchParams.get("lane");
        if (lane === "nearby") {
          await fulfil(route, [longFeaturePost], "proof-next-page");
          return;
        }
        await fulfil(route, [
          post("latest", "Camden after dark", "2026-08-05T19:00:00.000Z"),
          post(
            "earlier",
            "First round near the canal",
            "2026-08-05T18:00:00.000Z",
          ),
        ]);
      });

      await page.goto("/social");
      await expect(page.locator(".socialPostCard")).toHaveCount(2);
      expect(
        await page.evaluate(() => document.documentElement.dataset.theme),
      ).toBe(theme);
      const viewportFit = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(viewportFit.scrollWidth).toBeLessThanOrEqual(
        viewportFit.clientWidth,
      );

      if (target.mode === "mobile") {
        const controls = await page
          .locator(".socialSwitcher a, .socialLaneNav a")
          .all();
        for (const control of controls) {
          expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(
            44,
          );
        }
        await expect(
          page.getByRole("navigation", { name: "Primary" }),
        ).toBeVisible();
        const bottomPadding = await page
          .locator("main.socialPage")
          .evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).paddingBottom),
          );
        expect(bottomPadding).toBeGreaterThanOrEqual(120);
      } else {
        await expect(
          page.getByRole("navigation", { name: "Primary" }),
        ).toBeHidden();
        const [controlRail, feed, contextRail] = await Promise.all([
          page.locator(".socialControlRail").boundingBox(),
          page.locator(".socialFeed").boundingBox(),
          page.locator(".socialContextRail").boundingBox(),
        ]);
        expect(controlRail?.width).toBeGreaterThanOrEqual(220);
        expect(controlRail?.width).toBeLessThanOrEqual(240);
        expect(feed?.width).toBeGreaterThanOrEqual(560);
        expect(feed?.width).toBeLessThanOrEqual(640);
        expect(contextRail?.width).toBeGreaterThanOrEqual(260);
        expect(contextRail?.width).toBeLessThanOrEqual(300);
      }

      await expect(
        page.getByRole("button", { name: /new post|compose/i }),
      ).toHaveCount(0);
      if (saveProof) {
        await page.screenshot({
          path: join(proofDirectory, `${target.width}-${theme}.png`),
          fullPage: false,
        });
        if (target.width === 390 && theme === "light") {
          await page.goto("/social?feed=nearby&area=camden");
          await expect(
            page.getByText("Feature request", { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("link", { name: "Open venue" }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "Load more" }),
          ).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(390);
          await page.screenshot({
            path: join(proofDirectory, "390-nearby-long-light.png"),
            fullPage: true,
          });
        }
      }
      await context.close();
    }
  }
});
