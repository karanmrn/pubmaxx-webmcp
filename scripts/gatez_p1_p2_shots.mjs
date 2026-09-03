// GateZ P1/P2 regression evidence — captures (1) the map first-run screen
// showing the Tonight lane winning over the "Start with a story" overlay,
// and (2) the venue-sheet tab strip (deduped short labels) at 390px, with a
// real software WebGL2 context (SwiftShader), on an isolated port. Shots
// land in docs/screenshots/gatez/ (resolved from this file, not the cwd).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const BASE = process.env.GATEZ_BASE_URL ?? "http://localhost:3198";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs/screenshots/gatez");
const ARNOS_ARMS_ID = "venue-xjf3n0";

async function captureFirstRunTonightLane(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.addInitScript(() => {
      window.localStorage.setItem("pubmax-theme", "dark");
      // Seed the welcome tour as done (it's a distinct, separately-gated first-run
      // feature) so this shot isolates the "Start with a story" vs. Tonight lane
      // precedence under test. Deliberately NOT seeding the onboarding dismiss
      // key — that's the true first-run state the regression is about.
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/map`, { waitUntil: "load" });
    await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/p2-first-run-tonight-lane.png` });
  } finally {
    await context.close();
  }
}

async function captureVenueSheetTabs(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.addInitScript(() => {
      window.localStorage.setItem("pubmax-theme", "dark");
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/map?sel=${ARNOS_ARMS_ID}`, { waitUntil: "load" });
    await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/p1-venue-sheet-tabs.png` });
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    await captureFirstRunTonightLane(browser);
    await captureVenueSheetTabs(browser);
  } finally {
    await browser.close();
  }
}

run().then(
  () => {
    console.log("GateZ shots written to", OUT);
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
