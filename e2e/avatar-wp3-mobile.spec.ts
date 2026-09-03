import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const SHOT_DIR = "/tmp/pubmax-avatar-wp3";

test.describe("avatar WP3 mobile screenshots", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test("feed and contributors surfaces render initials fallback at 390px", async ({ page }) => {
    await page.goto("/feed");
    await expect(page.locator("main")).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, "feed-390.png"), fullPage: true });

    await page.goto("/contributors");
    await expect(page.getByRole("heading", { name: /contributor record/i })).toBeVisible();
    await page.screenshot({ path: join(SHOT_DIR, "contributors-390.png"), fullPage: true });
  });
});
