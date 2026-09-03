import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "page should not horizontally overflow at 390px").toBeLessThanOrEqual(1);
}

test.describe("mobile Activity", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax_handle", "mobileqa");
    });
    await page.route("**/api/notifications**", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: [] }),
      });
    });
    await page.route("**/api/profiles/mobileqa/quests**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ quests: [] }),
      });
    });
  });

  test("keeps the empty retention state and nav utilities thumb-safe", async ({ page }) => {
    const errors = pageErrors(page);
    const response = await page.goto("/activity");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing's landed yet.", exact: true })).toBeVisible();
    await expectTappable(page.getByRole("link", { name: "Browse the feed" }), "Browse the feed CTA");

    const siteNav = page.getByRole("navigation", { name: "Site navigation" });
    await expectTappable(siteNav.getByLabel("Open PUBMAXX landing page"), "mobile site wordmark");
    await expectTappable(siteNav.getByLabel(/^Activity/), "Activity bell");
    await expectTappable(siteNav.getByLabel(/^Messages/), "Messages bell");
    await expectTappable(siteNav.getByRole("button", { name: /switch to/i }), "theme toggle");

    const primaryNav = page.getByRole("navigation", { name: "Primary" });
    await expect(primaryNav).toBeVisible();
    await expectTappable(primaryNav.getByRole("link", { name: "Map", exact: true }), "bottom Map tab");
    await expectTappable(primaryNav.getByRole("link", { name: "Out", exact: true }), "bottom Out tab");
    await expectTappable(page.getByRole("button", { name: "Create" }), "create action");
    await expectTappable(primaryNav.getByRole("link", { name: "You", exact: true }), "bottom You tab");

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("empty state feeds the growth loop without clipping", async ({ page }) => {
    await page.goto("/activity");

    await page.getByRole("link", { name: "Browse the feed" }).click();
    await expect(page).toHaveURL(/\/feed$/);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("populated notifications expose thumb-safe actor and subject links", async ({ page }) => {
    const errors = pageErrors(page);
    const markReadPayloads: unknown[] = [];
    await page.unroute("**/api/notifications**");
    await page.route("**/api/notifications**", async (route) => {
      if (route.request().method() === "POST") {
        markReadPayloads.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ notifications: [], unread: 0 }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          unread: 3,
          notifications: [
            {
              id: "n-follow",
              actorHandle: "alice",
              kind: "follow",
              subjectRef: "alice",
              subjectLabel: "Alice",
              createdAt: "2026-07-13T18:00:00.000Z",
              read: false,
            },
            {
              id: "n-reaction",
              actorHandle: "bob",
              kind: "reaction",
              subjectRef: "drop-123",
              subjectLabel: "The Mobile Arms",
              createdAt: "2026-07-13T18:05:00.000Z",
              read: false,
            },
            {
              id: "n-crawl",
              actorHandle: "charlie",
              kind: "crawl_save",
              subjectRef: "victorian-soho",
              subjectLabel: "Victorian Soho",
              createdAt: "2026-07-13T18:10:00.000Z",
              read: true,
            },
          ],
        }),
      });
    });

    const response = await page.goto("/activity");
    expect(response?.status()).toBe(200);

    const list = page.locator(".activityList");
    await expect(list).toBeVisible();
    await expect(list.locator(".activityItem")).toHaveCount(3);
    await expect(list.locator(".activityItem.isUnread")).toHaveCount(2);
    await expect
      .poll(() => markReadPayloads.length, { message: "activity should mark notifications read" })
      .toBeGreaterThan(0);
    expect(markReadPayloads[0]).toMatchObject({ handle: "mobileqa" });

    const firstItem = list.locator(".activityItem").first();
    await expectTappable(firstItem.getByRole("link", { name: "@alice" }), "activity actor link");
    await expectTappable(firstItem.getByRole("link", { name: "View" }), "activity follow subject link");
    await expect(firstItem.getByRole("link", { name: "View" })).toHaveAttribute("href", "/u/alice");

    const reactionItem = list.locator(".activityItem").nth(1);
    await expectTappable(reactionItem.getByRole("link", { name: "@bob" }), "reaction actor link");
    await expectTappable(reactionItem.getByRole("link", { name: "View" }), "reaction subject link");
    await expect(reactionItem.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/map?drop=drop-123",
    );

    const crawlItem = list.locator(".activityItem").nth(2);
    await expectTappable(crawlItem.getByRole("link", { name: "@charlie" }), "crawl actor link");
    await expectTappable(crawlItem.getByRole("link", { name: "View" }), "crawl subject link");
    await expect(crawlItem.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/crawls/victorian-soho",
    );

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
