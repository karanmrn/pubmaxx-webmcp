import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const SHOTS_DIR = "docs/screenshots/tonight-vibe-chips";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

for (const [label, width] of [
  ["390", 390],
  ["1280", 1280],
] as const) {
  test(`tonight vibe chips use sentence case @${label}`, async ({ page }) => {
    test.setTimeout(60_000);
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });

    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    const vibe = page.locator(".vibeChip").first();
    await expect(vibe).toBeVisible({ timeout: 30_000 });

    // `none` and not merely "not uppercase": app/globals.css declares the same
    // class with `text-transform: lowercase`, so the label's own sentence case
    // only survives while the shared skin states none.
    const skin = await vibe.evaluate((el) => {
      const style = getComputedStyle(el);
      return { textTransform: style.textTransform, fontFamily: style.fontFamily };
    });
    expect(skin.textTransform).toBe("none");

    // Bungee draws cap-height glyphs only, so a chip on the party face reads as
    // ALL CAPS to the reader however text-transform computes. The label face is
    // the display one.
    expect(skin.fontFamily).not.toMatch(/bungee/i);
    // next/font renames the family (`__Space_Grotesk_<hash>`), so match the
    // face rather than the literal two-word name.
    expect(skin.fontFamily).toMatch(/grotesk/i);

    // The 44px floor is the chip's own geometry and is not the casing's to move.
    const box = await vibe.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The chips sit well below one phone viewport on /tonight, and toBeVisible
    // only asserts a non-empty box, so a viewport shot taken where the page
    // landed would be evidence of everything except the chips.
    await vibe.scrollIntoViewIfNeeded();
    await expect(vibe).toBeInViewport();
    await page.screenshot({
      path: `${SHOTS_DIR}/tonight-vibe-${label}.png`,
      fullPage: false,
    });
  });
}
