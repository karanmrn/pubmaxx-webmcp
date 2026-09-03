import { expect, test } from "@playwright/test";
import path from "node:path";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("Wanted Wave A phone chrome", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax:first-run-welcome:v1", "1");
      } catch {
        // Storage may be blocked.
      }
    });
  });

  test("You page shows the Wanted paste surface at 390x844", async ({ page }) => {
    await page.goto("/u/you", { waitUntil: "domcontentloaded" });
    const heading = page.getByRole("heading", { name: "Wanted" });
    await expect(heading).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Loading your Wanted list…")).toBeHidden({
      timeout: 20_000,
    });
    const pasteInput = page.getByLabel("Pub name or link");
    if (await pasteInput.isVisible().catch(() => false)) {
      await expect(pasteInput).toBeVisible();
      await expect(
        page.getByText(/never fetch Instagram or TikTok/i),
      ).toBeVisible();
    } else {
      await expect(page.getByText(/Sign in to keep a Wanted list/i)).toBeVisible();
    }
    await page.screenshot({
      path: path.join("/tmp", "wanted-wave-a-you-390.png"),
      fullPage: true,
    });
  });

  test("plan describe-first stays usable with Wanted chip lane absent when signed out", async ({
    page,
  }) => {
    const wantedReads: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/wanted") {
        wantedReads.push(url.search);
      }
    });
    await page.goto("/plan", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /What.?s the plan/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("Your Wanted list")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(wantedReads).toEqual([]);
    await page.screenshot({
      path: path.join("/tmp", "wanted-wave-a-plan-390.png"),
      fullPage: true,
    });
  });
});
