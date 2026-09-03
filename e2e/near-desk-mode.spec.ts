import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const SHOTS_DIR = "docs/screenshots/near-desk-mode";

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function prepareReturningVisitor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
}

test.describe("near desk mode", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("switches Pint to Desk and serves an honest Soho answer", async ({ page }) => {
    const errors = watchErrors(page);
    await prepareReturningVisitor(page);
    const response = await page.goto("/near?patch=soho");
    expect(response?.status()).toBe(200);

    const modeSwitch = page.getByRole("radiogroup", { name: "Near mode" });
    await expect(modeSwitch).toBeVisible();
    const pintOption = page.getByRole("radio", { name: "Pint" });
    const deskOption = page.getByRole("radio", { name: "Desk" });
    await expect(pintOption).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("section.nmn")).toBeVisible();
    await expect(page.locator(".nmnCard").first()).toBeVisible();

    await deskOption.click();
    await expect(deskOption).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(/mode=desk/);
    await expect(page.getByRole("heading", { name: /Somewhere to sit around Soho/ })).toBeVisible();
    await expect(page.locator(".ndnHero .ndnHeroName")).toBeVisible();
    await expect(page.locator(".ndnHero .ndnFacts li").first()).toBeVisible();
    await expect(
      page
        .getByText(/^(Open until |Open all day|Opens |Closed today|Hours unknown)/)
        .first(),
    ).toBeVisible();
    await expect(page.getByText("Laptops: not known")).toHaveCount(0);
    await expect(page.getByText("No seat data yet")).toHaveCount(0);
    await expect(page.getByText(/^Checked /).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "OpenStreetMap contributors" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("deep-links desk mode and names a thin locality honestly", async ({ page }) => {
    const errors = watchErrors(page);
    await prepareReturningVisitor(page);
    await page.route("**/data/london_desks/desks.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          source: "osm",
          observedAt: "2026-08-16T04:01:27.583Z",
          venues: [],
        }),
      });
    });
    const response = await page.goto("/near?mode=desk&patch=soho");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("radio", { name: "Desk" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("No desks logged near here yet - add a spot")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("captures light and dark desk answers at 390", async ({ page }) => {
    mkdirSync(SHOTS_DIR, { recursive: true });
    await prepareReturningVisitor(page);
    await page.goto("/near?mode=desk&patch=soho");
    await expect(page.getByRole("heading", { name: /Somewhere to sit around Soho/ })).toBeVisible();

    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.screenshot({
      path: path.join(SHOTS_DIR, "desk-soho-390-light.png"),
      fullPage: true,
    });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({
      path: path.join(SHOTS_DIR, "desk-soho-390-dark.png"),
      fullPage: true,
    });
  });
});
