import { expect, test } from "@playwright/test";

// The gate, from the browser's side.
//
// Signed-out Social still hides protected crew and directory data. Handle
// search and invite-link actions remain available in the control rail.

const PHONE = { width: 390, height: 844 };

test.describe("Signed-out Social", () => {
  test("offers no crew surface anywhere on the page", async ({ page }) => {
    await page.goto("/social");
    await expect(
      page.getByRole("heading", { name: "Social", exact: true }),
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "Your crews" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start a crew" })).toHaveCount(0);
    await expect(page.locator('a[href^="/social/crews/"]')).toHaveCount(0);
    await expect(page.locator(".crews")).toHaveCount(0);
  });

  test("keeps handle search open while the directory stays behind the boundary", async ({
    page,
  }) => {
    await page.goto("/social");
    await expect(
      page.getByRole("heading", { name: "Find your lot" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "People on PUBMAXX" }).first(),
    ).toHaveCount(0);
    await expect(page.locator(".peopleDir")).toHaveCount(0);
  });

  test("structured invite failures render fallback copy", async ({ page }) => {
    await page.route("**/api/referrals/invite-link", async (route) => {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "X" } }),
      });
    });
    await page.goto("/social");

    const inviteButton = page.getByRole("button", { name: "Get invite link" }).first();
    await expect(inviteButton).toBeVisible();
    await inviteButton.click();

    const notice = page.locator(".findLot__error").filter({ hasText: "Could not mint an invite link." }).first();
    await expect(notice).toBeVisible();
    await expect(page.getByText("[object Object]", { exact: true })).toHaveCount(0);
  });

  test("signed-out Social does not request or render a directory empty state", async ({
    page,
  }) => {
    let directoryReads = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/profiles/directory") {
        directoryReads += 1;
      }
    });
    await page.goto("/social");
    await expect(
      page.getByRole("heading", { name: "Social", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Find your lot" }).first(),
    ).toBeVisible();
    await expect(page.locator(".peopleDir")).toHaveCount(0);
    await expect(page.getByText("You already follow everyone here.")).toHaveCount(0);
    await expect(
      page.getByText("Nobody has claimed a handle yet."),
    ).toHaveCount(0);
    expect(directoryReads).toBe(0);
  });

  test("the directory publishes handles and never an email", async ({ request }) => {
    const response = await request.get("/api/profiles/directory?limit=5");
    expect(response.status()).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("@example.com");
    expect(raw).not.toMatch(/"email"/);
    expect(raw).not.toMatch(/"userId"/);
    expect(raw).not.toMatch(/"dateOfBirth"/);
    const body = (await response.json()) as { people: unknown[] };
    expect(Array.isArray(body.people)).toBe(true);
  });

  test("a crew page never leaks a crew to a reader Social has not verified", async ({
    page,
  }) => {
    await page.goto("/social/crews/50000000-0000-4000-8000-000000000001");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Either "not open to you" or the load failure. Never a member view.
    await expect(page.getByRole("heading", { name: "Who is in" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Leave this crew/ })).toHaveCount(0);
  });
});

test.describe("A profile statistic is a way in", () => {
  test.use({ viewport: PHONE });

  test("every tile links to a surface that exists", async ({ page }) => {
    await page.goto("/u/pubmaxx");
    const stats = page.locator(".profileStats");
    await expect(stats).toBeVisible();

    const links = stats.locator("a.profileStatLink");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < count; index += 1) {
      const href = await links.nth(index).getAttribute("href");
      expect(href, "every tile carries a destination").toBeTruthy();
      expect(href).toMatch(/^\/u\/pubmaxx(#|\/people\/)/);
    }
  });

  test("the tiles stay 44px tall and the row never scrolls sideways at 390px", async ({
    page,
  }) => {
    await page.goto("/u/pubmaxx");
    const link = page.locator("a.profileStatLink").first();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the followers surface opens and says whose it is", async ({ page }) => {
    await page.goto("/u/pubmaxx/people/followers");
    await expect(page.getByRole("heading", { name: "Followers" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the profile" })).toBeVisible();
  });

  test("the following surface is its own page, not the same list twice", async ({
    page,
  }) => {
    await page.goto("/u/pubmaxx/people/following");
    await expect(page.getByRole("heading", { name: "Following" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Followers" })).toHaveCount(0);
  });

  test("following rows paint owned avatars when the API carries them at 390px", async ({
    page,
  }) => {
    await page.route("**/api/profiles/pubmaxx/following", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          following: [
            {
              handle: "alice",
              displayName: "Alice",
              avatarUrl: "/api/avatar/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/1",
            },
          ],
        }),
      });
    });
    await page.route("**/api/profiles/pubmaxx/lot", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ lot: [] }),
      });
    });
    await page.goto("/u/pubmaxx/people/following");
    await expect(page.getByRole("heading", { name: "Following" })).toBeVisible();
    const avatar = page.locator(".peopleDir__avatar img");
    await expect(avatar).toHaveCount(1);
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute(
      "src",
      /\/api\/avatar\/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\/1/,
    );
  });
});
