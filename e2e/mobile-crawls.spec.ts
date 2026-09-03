import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MIN_TAP_TARGET = 44;

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        rootOverflow: document.documentElement.scrollWidth - window.innerWidth,
        bodyOverflow: document.body.scrollWidth - window.innerWidth,
      })),
    )
    .toEqual({
      viewportWidth: MOBILE_VIEWPORT.width,
      rootOverflow: expect.any(Number),
      bodyOverflow: expect.any(Number),
    });

  const overflow = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollWidth - window.innerWidth,
      document.body.scrollWidth - window.innerWidth,
    ),
  );
  expect(overflow, "page should not scroll horizontally at 390px").toBeLessThanOrEqual(1);
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  expect(Math.round(box!.width), `${label} width`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test.describe("mobile Crawls surfaces", () => {
  test("/crawls renders one featured crawl + compact rows with thumb-sized primary actions and no horizontal overflow", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = watchPageErrors(page);

    const response = await page.goto("/crawls");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Every pint has a story." })).toBeVisible();

    // List-discipline pass: the old repeated full-card grid is now ONE
    // featured card (with the route thumb + plan CTA) plus compact,
    // one-line rows for every other curated crawl, grouped by theme.
    const featuredCard = page.locator(".curatedFeaturedCard");
    await expect(featuredCard).toBeVisible();
    expect(await page.locator(".curatedCard").count(), "exactly one full card").toBe(1);

    const featuredPlanButton = featuredCard.locator(".curatedPlanBtn");
    await expectTappable(featuredPlanButton, "featured crawl plan action");

    const compactRows = page.locator(".crawlCompactLink");
    const rowCount = await compactRows.count();
    expect(rowCount, "compact crawl rows should render").toBeGreaterThanOrEqual(3);
    const rowBoxes = await compactRows.evaluateAll((links) =>
      links.map((link) => {
        const rect = link.getBoundingClientRect();
        return {
          label: link.textContent?.trim() ?? "compact crawl row",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
    );
    for (const box of rowBoxes) {
      expect(box.width, `${box.label} width`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
      expect(box.height, `${box.label} height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }

    await expectTappable(
      page.getByRole("link", { name: "Build your own crawl on the map" }),
      "build your own crawl action",
    );
    await expectNoHorizontalOverflow(page);

    await expect(featuredPlanButton).toHaveAttribute("href", /\/map\?mode=build&pubs=/);
    await featuredPlanButton.click();
    await expect(page).toHaveURL(/\/map\?mode=build&pubs=/, { timeout: 30_000 });

    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
    if ((await planner.count()) === 0) await page.locator(".mobilePlanActivation").click();
    await expect(planner).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
    await expect(planner.getByRole("heading", { name: "Plan an outing" })).toBeVisible();

    const routePanel = planner.locator(".routePanel");
    const stops = routePanel.locator("ol.routeList > li");
    await expect.poll(() => stops.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await expectTappable(
      routePanel.getByRole("button", { name: /Copy a shareable link/i }),
      "crawl share action",
    );
    await expectNoHorizontalOverflow(page);

    expect(errors).toEqual([]);
  });

  test("unknown crawl story stays usable on mobile", async ({ page }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/crawls/not-a-real-crawl-story");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { name: "No crawl here" })).toBeVisible();

    const backToCrawls = page.getByRole("link", { name: "Back to crawls" });
    await expect(backToCrawls).toHaveAttribute("href", "/crawls");
    await expectTappable(backToCrawls, "back to crawls action");

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
