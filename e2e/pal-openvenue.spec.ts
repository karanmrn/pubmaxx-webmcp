import { mkdir, writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const PHONE = { width: 390, height: 844 };
const SHOTS_DIR = process.env.PAL_OPENVENUE_SHOTS_DIR ?? "";

async function askOnPhone(page: import("@playwright/test").Page, ask: string) {
  await page.getByRole("textbox", { name: /Describe the outing/i }).fill(ask);
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, {
    timeout: 20_000,
  });
}

test.describe("Pub Pal venue card opens the map sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-theme", "dark");
      document.documentElement.dataset.theme = "dark";
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    });
  });

  test("tapping a venue card lands on the map with that pub selected", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.goto("/pal/chat");
    await askOnPhone(page, "Quiet-ish near Bank, not pricey");

    const card = page.locator(".palChatCard").first();
    await expect(card).toBeVisible();
    const venueLink = card.locator(".palChatCardBody--link");
    await expect(venueLink).toBeVisible();

    await venueLink.click();

    await expect(page).toHaveURL(/\/map\?sel=/, { timeout: 45_000 });
    const venueId = new URL(page.url()).searchParams.get("sel");
    expect(venueId).toBeTruthy();

    const inspector = page.locator(".venueInspector");
    await expect(inspector).toBeAttached({ timeout: 60_000 });

    if (SHOTS_DIR) {
      await mkdir(SHOTS_DIR, { recursive: true });
      const png = await page.screenshot({ fullPage: false });
      await writeFile(`${SHOTS_DIR}/pal-card-tap-venue-sheet-390-dark.png`, png);
    }
  });
});
