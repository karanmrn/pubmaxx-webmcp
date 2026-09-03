import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "page should not horizontally overflow at 390px").toBeLessThanOrEqual(1);
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(Math.round(box.height), `${label} should meet the 44px mobile tap target`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.width), `${label} should be wide enough to tap`).toBeGreaterThanOrEqual(44);
}

async function waitForFeedOutcome(page: Page): Promise<"cards" | "empty"> {
  const cards = page.locator(".feedCard:not(.feedCardSkeleton)");
  const empty = page.locator(".feedEmpty");
  await expect
    .poll(async () => (await cards.count()) + (await empty.count()), {
      message: "feed should settle to cards or an empty state",
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  return (await cards.count()) > 0 ? "cards" : "empty";
}

test.describe("mobile feed actions", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.route("**/api/pint-drops", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          drops: [
            {
              id: "mobile-feed-drop-1",
              handle: "old_ken",
              priceGbp: 4.8,
              drink: "Guinness",
              passedDownNote: "Proper corner table, good chatter, easy route home.",
              era: "2020s",
              provenance: "contributor",
              venueId: "venue-mobile-feed",
              venueName: "The Mobile Arms",
              venueMapUrl: "/map?sel=venue-mobile-feed",
              createdAt: "2026-07-13T19:00:00.000Z",
              vibeTags: ["cheap", "after work"],
              pintPhotoUrl: null,
              venuePhotoUrl: null,
            },
          ],
        }),
      });
    });
    await page.route("**/api/pint-drops/reactions?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          summaries: {
            "mobile-feed-drop-1": {
              counts: { cheers: 2, bargain: 1 },
              mine: [],
            },
          },
        }),
      });
    });
    await page.route("**/api/profiles/*/following", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ following: [] }),
      });
    });
  });

  test("lanes and card actions stay thumb-safe without overflow", async ({ page }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/feed");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".feedTitle")).toHaveText("Stories");
    await expectNoHorizontalOverflow(page);

    const chips = page.locator(".feedFilterChip");
    await expect(chips.first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Latest", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Top picks", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yours", exact: true })).toHaveCount(0);
    const visibleChipCount = await chips.count();
    for (let index = 0; index < Math.min(visibleChipCount, 6); index += 1) {
      const chip = chips.nth(index);
      if (await chip.isVisible()) await expectTappable(chip, `feed lane chip ${index + 1}`);
    }

    const outcome = await waitForFeedOutcome(page);
    if (outcome === "empty") {
      await expect(page.locator(".feedEmpty")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
      return;
    }

    const firstCard = page.locator(".feedCard:not(.feedCardSkeleton)").first();
    await expect(firstCard).toBeVisible();

    const reactions = firstCard.locator(".feedReactBtn");
    const reactionCount = await reactions.count();
    for (let index = 0; index < Math.min(reactionCount, 5); index += 1) {
      await expectTappable(reactions.nth(index), `feed reaction ${index + 1}`);
    }

    const actions = firstCard.locator(".feedCardAction");
    const actionCount = await actions.count();
    for (let index = 0; index < actionCount; index += 1) {
      await expectTappable(actions.nth(index), `feed card action ${index + 1}`);
    }

    await expectTappable(firstCard.locator(".feedPermalink"), "feed permalink");

    const shareButtons = firstCard.locator(".shareBar__btn");
    const shareCount = await shareButtons.count();
    for (let index = 0; index < Math.min(shareCount, 4); index += 1) {
      await expectTappable(shareButtons.nth(index), `feed share button ${index + 1}`);
    }

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
