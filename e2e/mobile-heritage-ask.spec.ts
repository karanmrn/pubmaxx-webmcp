import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };
const STORY_VENUE_ID = "venue-xiesdn"; // The Dog & Duck, Soho — has shipped heritage facts.

const TAB_LABELS = ["Overview", "Drinks", "Stories", "Lore", "Ask", "Last train"] as const;

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function expectTouchTarget(locator: Locator, label: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator, `${label} should be visible before measuring`).toBeVisible();

  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  expect(box.width, `${label} width should be at least 44px`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height should be at least 44px`).toBeGreaterThanOrEqual(44);
}

async function expectNoPageHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rootOverflow = document.documentElement.scrollWidth - window.innerWidth;
        const bodyOverflow = document.body.scrollWidth - window.innerWidth;
        return Math.max(rootOverflow, bodyOverflow);
      }),
    )
    .toBeLessThanOrEqual(1);
}

async function expectAllVisibleTouchTargets(
  locator: Locator,
  label: string,
): Promise<void> {
  const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return { width: rect.width, height: rect.height, visible: style.display !== "none" && style.visibility !== "hidden" };
  }).filter((box) => box.visible));
  expect(boxes.length, `${label} should exist`).toBeGreaterThan(0);

  for (const [index, box] of boxes.entries()) {
    expect(box.width, `${label} ${index + 1} width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${label} ${index + 1} height`).toBeGreaterThanOrEqual(44);
  }
}

test("mobile venue Lore and Ask surfaces stay reachable and thumb-safe keyless", async ({
  page,
}) => {
  const response = await page.goto(`/map?sel=${STORY_VENUE_ID}&mode=build`);
  expect(response?.status()).toBe(200);

  const sheet = page.locator(".mapDrawer.right.open");
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet).toHaveClass(/sheet-half/);

  const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
  await expect(tablist).toBeVisible();

  for (const label of TAB_LABELS) {
    await expectTouchTarget(tablist.getByRole("tab", { name: label, exact: true }), `${label} tab`);
  }
  await expectNoPageHorizontalOverflow(page);

  const loreTab = tablist.getByRole("tab", { name: "Lore", exact: true });
  await loreTab.click();
  await expect(sheet).toHaveClass(/sheet-full/);

  const storyPanel = page.locator("#venuePanel-story");
  await expect(storyPanel).toBeVisible();
  await expect(storyPanel.getByRole("link", { name: "Wikipedia", exact: true })).toBeVisible();
  await expect(storyPanel.locator(".placeStories")).toBeVisible();

  await expectAllVisibleTouchTargets(
    storyPanel.locator(".heritageFactCite, .placeStoryWalk, .placeStoryCrawl, .placeStorySource"),
    "Lore action",
  );
  await expectNoPageHorizontalOverflow(page);

  const askTab = tablist.getByRole("tab", { name: "Ask", exact: true });
  await askTab.scrollIntoViewIfNeeded();
  await askTab.click();

  const askPanel = page.locator("#venuePanel-ask");
  await expect(askPanel).toBeVisible();
  await expectNoPageHorizontalOverflow(page);

  await expectTouchTarget(askPanel.getByRole("button", { name: "Tell me about this pub" }), "Landlord primary ask");

  const askInput = askPanel.getByLabel("Ask about this pub");
  await expectTouchTarget(askInput, "Landlord text input");
  await askInput.fill("How old is it?");
  await expect(askInput).toHaveValue("How old is it?");

  const sendButton = askPanel.getByRole("button", { name: "Send" });
  await expectTouchTarget(sendButton, "Landlord send");
  await expectAllVisibleTouchTargets(askPanel.locator(".landlordSuggest button"), "Landlord suggestion");

  await sendButton.click();
  await expect(askPanel.getByRole("status")).toContainText("Here's what's on record", {
    timeout: 30_000,
  });
  await expect(askPanel.getByText(/Dog and Duck at 18 Bateman Street/i)).toBeVisible();
  await expectAllVisibleTouchTargets(askPanel.locator(".citationChip"), "Landlord citation");
  await expectNoPageHorizontalOverflow(page);
});
