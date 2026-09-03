import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const url = message.location().url;
    const keylessAuthNoise =
      url.includes("pubmaxx-e2e.supabase.co") ||
      text.includes("wss://pubmaxx-e2e.supabase.co/realtime/");
    if (!keylessAuthNoise) errors.push(text);
  });
  return errors;
}

async function prepareReturningVisitor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
}

test("Near shows prices before bounded publisher evidence on mobile", async ({ page }) => {
  const errors = watchErrors(page);
  const trustRequests: string[] = [];
  let releaseTrust!: () => void;
  const trustGate = new Promise<void>((resolve) => {
    releaseTrust = resolve;
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await prepareReturningVisitor(page);
  await page.route("**/api/near-price-trust**", async (route) => {
    trustRequests.push(route.request().url());
    await trustGate;
    await route.continue();
  });

  const response = await page.goto("/near?patch=soho", { waitUntil: "commit" });
  expect(response?.status()).toBe(200);
  const cards = page.locator(".nmnCard");
  await expect(cards).toHaveCount(5);
  await expect(cards.first().locator(".nmnCardPriceValue")).toBeVisible();
  await expect(cards.first().locator(".nmnCardTrust")).toHaveText(
    "On record · Checking publisher",
  );

  releaseTrust();
  await expect(page.locator(".nmnCardTrust")).toHaveCount(5);
  await expect(page.locator(".nmnPriceCollected")).toHaveText(
    "Prices last collected 3 July 2026.",
  );

  expect(trustRequests).toHaveLength(1);
  const trustUrl = new URL(trustRequests[0]);
  expect(trustUrl.searchParams.getAll("venueId")).toHaveLength(5);
  expect(trustUrl.search).not.toMatch(/lat|lng|price|borough/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  const firstRow = await cards.first().boundingBox();
  const tabBar = await page.locator(".mobileTabBar").boundingBox();
  expect(firstRow).not.toBeNull();
  expect(tabBar).not.toBeNull();
  const visibleHeight = Math.min(firstRow!.y + firstRow!.height, tabBar!.y) - firstRow!.y;
  expect(visibleHeight).toBeGreaterThanOrEqual(44);

  const firstVenueName = await cards.first().locator(".nmnCardName").textContent();
  await cards.first().click();
  await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=/);
  await expect(page.locator(".venueInspector")).toContainText(firstVenueName ?? "");

  expect(errors).toEqual([]);
});

test("Near keeps trust layout usable in dark desktop mode", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await prepareReturningVisitor(page);

  const response = await page.goto("/near?patch=soho", { waitUntil: "commit" });
  expect(response?.status()).toBe(200);
  await expect(page.locator(".nmnCard")).toHaveCount(5);
  await expect(page.locator(".nmnCardTrust")).toHaveCount(5);
  await expect(page.locator(".nmnPriceCollected")).toHaveText(
    "Prices last collected 3 July 2026.",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  expect(errors).toEqual([]);
});
