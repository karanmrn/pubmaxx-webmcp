import { expect, test } from "@playwright/test";

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";

async function captureAnalytics(page: import("@playwright/test").Page): Promise<unknown[]> {
  const payloads: unknown[] = [];
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) payloads.push(JSON.parse(raw));
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  return payloads;
}

test.describe("trusted handoff analytics consent boundary", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("consent granted sends one fixed sanitized Tonight event", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "granted"), CONSENT_KEY);
    const payloads = await captureAnalytics(page);

    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    await expect.poll(
      () => payloads.filter((payload) => (
        payload && typeof payload === "object" && (payload as { name?: unknown }).name === "tonight_screen_view"
      )).length,
    ).toBe(1);

    const payload = payloads.find((row) => (
      row && typeof row === "object" && (row as { name?: unknown }).name === "tonight_screen_view"
    ));
    expect(payload).toMatchObject({
      name: "tonight_screen_view",
      props: {},
      path: "/tonight",
      analyticsConsent: true,
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /venueId|planId|invite|capability|coordinates|latitude|longitude|query|sourceUrl|friendName/,
    );
  });

  test("consent denied sends zero analytics requests", async ({ page }) => {
    const payloads = await captureAnalytics(page);

    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    expect(payloads).toEqual([]);
  });

  test("Do Not Track sends zero analytics requests even with consent", async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, "granted");
      Object.defineProperty(navigator, "doNotTrack", { configurable: true, get: () => "1" });
    }, CONSENT_KEY);
    const payloads = await captureAnalytics(page);

    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    expect(payloads).toEqual([]);
  });
});
