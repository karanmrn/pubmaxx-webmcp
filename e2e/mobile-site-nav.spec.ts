import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, `${label} should not horizontally overflow`).toBeLessThanOrEqual(1);
}

test.describe("site navigation touch targets", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("keeps dense tablet navigation links and utilities thumb-safe", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/pubs");

    const nav = page.getByRole("navigation", { name: "Site navigation" });
    await expect(nav).toBeVisible();
    await expectTappable(nav.getByLabel("Open PUBMAXX landing page"), "tablet site wordmark");
    await expectTappable(nav.getByRole("link", { name: "Map", exact: true }), "tablet Map link");
    await expectTappable(nav.getByRole("link", { name: "Social", exact: true }), "tablet Social link");
    await expectTappable(nav.getByRole("link", { name: "Now", exact: true }), "tablet Now link");
    await expectTappable(nav.getByRole("link", { name: "Out", exact: true }), "tablet Out link");
    await expectTappable(nav.getByLabel(/^Activity/), "tablet Activity bell");
    await expectTappable(nav.getByLabel(/^Messages/), "tablet Messages bell");
    await expectTappable(nav.getByRole("button", { name: /switch to/i }), "tablet theme toggle");
    const signIn = nav.getByRole("button", { name: "Sign in" });
    if ((await signIn.count()) > 0) {
      await expectTappable(signIn, "tablet sign-in trigger");
    }
    await expectNoHorizontalOverflow(page, "tablet site nav");
  });

  test("keeps the command-palette affordance large enough when it is visible", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/pubs");

    const nav = page.getByRole("navigation", { name: "Site navigation" });
    await expectTappable(
      nav.getByRole("button", { name: "Open command palette" }),
      "command palette trigger",
    );
    await expectNoHorizontalOverflow(page, "desktop-small site nav");
  });
});
