// F3 screenshot gate — captures the concierge-as-map-home affordance on the map
// with a real software WebGL2 context (SwiftShader), on an isolated port. Shots
// land in docs/screenshots/f3/ (resolved from this file, not the cwd). "before"
// hides the concierge pill (display:none) to show the prior map-home; "after"
// shows the F3 collapsed pill + open panel.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const BASE = process.env.F3_BASE_URL ?? "http://localhost:3187";
// Anchored to the repo root via import.meta.url so launching from a
// subdirectory can't scatter artifacts elsewhere.
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs/screenshots/f3");

const THEMES = ["light", "dark"];

async function captureTheme(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    await context.addInitScript((t) => {
      window.localStorage.setItem("pubmax-theme", t);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      // Suppress the §4.5 "Start with a story" onboarding overlay so it never
      // intercepts the concierge pill click.
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    const page = await context.newPage();
    await page.goto(`${BASE}/map`, { waitUntil: "load" });
    await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(2500);

    // BEFORE: hide the F3 affordance to show the prior bottom lane. Keep the
    // style handle for an exact restore, and assert the pill is really hidden
    // before capturing so the "before" shot can't silently include it.
    const hideStyle = await page.addStyleTag({
      content: ".mapConciergeAsk{display:none !important}",
    });
    await page.locator(".mapConciergeAsk").waitFor({ state: "hidden", timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/before-map-${theme}.png` });

    // AFTER (collapsed): remove exactly the style we added; show the pill.
    await hideStyle.evaluate((node) => node.remove());
    await page.locator(".mapConciergeAskPill").waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/after-collapsed-${theme}.png` });

    // AFTER (open): expand the panel — idle state with the input + example asks.
    // (The grounded happy-path needs a real Supabase-backed durable limiter,
    // which fails closed against placeholder creds locally, so we capture the
    // affordance itself rather than a locally-429'd answer.)
    await page.locator(".mapConciergeAskPill").click();
    await page.locator(".mapConciergeAskInput").waitFor({ state: "visible", timeout: 5000 });
    await page.locator(".mapConciergeAskInput").fill("Quiet-ish near Bank, 4 of us");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/after-open-${theme}.png` });
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    for (const theme of THEMES) {
      await captureTheme(browser, theme);
    }
  } finally {
    await browser.close();
  }
}

run().then(
  () => {
    console.log("F3 shots written to", OUT);
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
