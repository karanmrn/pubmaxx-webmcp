/**
 * Piccadilly landmark-inspector screenshots (390) for map-fix lane.
 * Usage: node scripts/map-fix-shots.mjs --base-url http://127.0.0.1:PORT --label after
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]
  : "http://127.0.0.1:3000";
const label = process.argv.includes("--label")
  ? process.argv[process.argv.indexOf("--label") + 1]
  : "shot";
const outDir = join(process.cwd(), "pubmax-wave-screenshots", "map-fix");

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader-webgl"],
});

async function shot(theme) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const page = await context.newPage();
  await page.addInitScript((t) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    document.documentElement.dataset.theme = t;
  }, theme);

  const url = `${baseUrl}/map?landmark=piccadilly-circus`;
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!res || res.status() >= 400) {
    throw new Error(`goto failed: ${res?.status()}`);
  }
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);

  await page.locator(".maplibreMap canvas").first().waitFor({ state: "visible", timeout: 45_000 });
  // Let tiles + landmark fly settle.
  await page.waitForTimeout(8_000);

  const stats = await page.evaluate(() => {
    const canvas = document.querySelector(".maplibreMap canvas");
    return {
      recovery: document
        .querySelector(".maplibreMap")
        ?.getAttribute("data-webgl-recovery"),
      hasCanvas: Boolean(canvas),
    };
  });
  await page.waitForTimeout(1500);

  const path = join(outDir, `piccadilly-z15-390-${theme}-${label}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(JSON.stringify({ path, theme, label, stats }));
  await context.close();
}

await shot("dark");
await shot("light");
await browser.close();
