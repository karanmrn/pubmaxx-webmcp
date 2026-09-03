import { expect, type Locator, type Page, test } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);
}

async function expectTouchHeight(locator: Locator, minHeight = 44) {
  await expect(locator).toBeVisible();
  await expect
    .poll(async () => (await locator.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(minHeight);
}

test("mobile Plan flow stays tappable and usable at 390px", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });

  const response = await page.goto("/plan");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Describe the outing. We’ll put it in order." })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // This test exercises the full composer (its own template chips, editable
  // context fields), which needs the wizard's own "Describe instead" skip,
  // not the describe-first entry surface's own free-text field.
  await page.getByRole("button", { name: "Guide me instead" }).click();
  await page.getByRole("button", { name: "Describe instead" }).click();
  await expectTouchHeight(page.getByRole("textbox", { name: "Describe the outing" }));
  await expectTouchHeight(page.getByRole("button", { name: "Make a plan" }));
  await expectNoHorizontalOverflow(page);

  const templateChips = page.locator(".planComposer__template");
  const templateCount = await templateChips.count();
  expect(templateCount).toBeGreaterThan(0);
  for (let index = 0; index < templateCount; index += 1) {
    await expectTouchHeight(templateChips.nth(index));
  }

  await page.getByRole("button", { name: "Watch the match" }).click();
  await expect(page.getByLabel("Describe the outing")).toHaveValue("pubs screening live sport tonight in Clapham");
  await expectNoHorizontalOverflow(page);

  await page.getByLabel("Describe the outing").fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Make a plan" }).click();

  await expect(page.locator("#plan-concierge-status")).toContainText("stops we can stand behind");
  await expect(page.getByRole("combobox", { name: "Area" })).toHaveValue("clapham");
  await expect(page.getByRole("spinbutton", { name: "People" })).toHaveValue("4");

  const contextControls = page.locator(".planComposer__context label");
  const contextControlCount = await contextControls.count();
  expect(contextControlCount).toBe(8);
  for (let index = 0; index < contextControlCount; index += 1) {
    await expectTouchHeight(contextControls.nth(index));
  }
  const editableContextControls = page.locator(".planComposer__context select, .planComposer__context input");
  const editableContextControlCount = await editableContextControls.count();
  expect(editableContextControlCount).toBe(8);
  for (let index = 0; index < editableContextControlCount; index += 1) {
    await expectTouchHeight(editableContextControls.nth(index));
  }
  await page.getByRole("combobox", { name: "Time" }).selectOption("late_night");
  await page.getByRole("spinbutton", { name: "People" }).fill("5");
  await expect(page.getByRole("combobox", { name: "Time" })).toHaveValue("late_night");
  await expect(page.getByRole("spinbutton", { name: "People" })).toHaveValue("5");
  const regenerateRoute = page.getByRole("button", { name: "Regenerate route" });
  await expectTouchHeight(regenerateRoute);
  await regenerateRoute.click();
  await expect(page.locator("#plan-route-status")).toContainText("Route refreshed");

  await page.getByText("Area coverage", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Crawl-ready", exact: true })).toBeVisible();
  await expectTouchHeight(page.getByRole("link", { name: "Explore Clapham pubs on the map" }));
  await expectNoHorizontalOverflow(page);

  await expectTouchHeight(page.getByLabel("Venue name").first());
  await expectTouchHeight(page.getByRole("button", { name: "Remove stop 1" }));
  await expectTouchHeight(page.getByRole("button", { name: "Add another stop" }));
  await expectTouchHeight(page.getByRole("button", { name: "Lock it in" }), 48);

  await page.getByLabel("Your name").fill("Terra");
  await page.getByRole("button", { name: "Lock it in" }).click();

  // Lock lands on the plan page at its share step (#share since #816).
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(#share)?$/);
  await expect(page.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(page.getByText("Terra", { exact: true })).toBeVisible();
  await expectTouchHeight(page.getByRole("button", { name: "In", exact: true }));
  await expectTouchHeight(page.getByRole("button", { name: "On the way", exact: true }));
  await expectNoHorizontalOverflow(page);
});
