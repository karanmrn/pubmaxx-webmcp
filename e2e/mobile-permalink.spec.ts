import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MIN_TAP_TARGET = 44;

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      })),
    )
    .toEqual(
      expect.objectContaining({
        viewportWidth: MOBILE_VIEWPORT.width,
        scrollWidth: expect.any(Number),
        bodyScrollWidth: expect.any(Number),
      }),
    );

  const { scrollWidth, bodyScrollWidth, viewportWidth } = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  expect(Math.max(scrollWidth, bodyScrollWidth)).toBeLessThanOrEqual(viewportWidth);
}

async function expectTappable(locator: Locator, label: string) {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} has a bounding box`).not.toBeNull();
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem("pubmax-e2e-permalink-copy", value);
        },
      },
    });
  });
});

test("mobile unknown Pint Drop permalink has a tappable empty-state action and no horizontal overflow", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/p/unknown-or-missing");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".permalink--empty")).toBeVisible();
  await expect(page.getByRole("heading", { name: "This pint isn’t on the wall" })).toBeVisible();

  const primaryAction = page
    .locator(".permalink--empty")
    .getByRole("link", { name: "Go to the feed" });
  await expect(primaryAction).toHaveAttribute("href", "/feed");
  await expectTappable(primaryAction, "empty-state primary action");
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("mobile seeded Pint Drop permalink exposes tappable action and share controls", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  // This seed is already used by the broad social-loop spec and is merged into
  // the read path, so this check stays read-only and does not require Supabase.
  const response = await page.goto("/p/seed-prospect-1");
  expect(response?.status()).toBe(200);

  const card = page.locator(".permalink__mat");
  await expect(card).toBeVisible();

  const copyAction = card.locator("[data-copy-link]");
  await expectTappable(copyAction, "copy-link action");
  await copyAction.click();
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-permalink-copy"))).toContain(
    "/p/seed-prospect-1",
  );

  await expectTappable(
    card.getByRole("link", { name: "Open the pub on the map" }),
    "open-on-map action",
  );
  await expectTappable(card.getByRole("link", { name: "Open the Ledger" }), "ledger action");

  const shareControls = card.locator(".permalink__share .shareBar__btn");
  await expect(shareControls.first()).toBeVisible();
  const shareCount = await shareControls.count();
  expect(shareCount, "seeded permalink share controls").toBeGreaterThanOrEqual(3);
  for (let index = 0; index < shareCount; index += 1) {
    await expectTappable(shareControls.nth(index), `share control ${index + 1}`);
  }

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
