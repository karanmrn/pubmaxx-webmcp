// R4 screenshot gate — captures the photo-less venue sheet (Arnos Arms,
// venue-xjf3n0) at mobile (390) and desktop (1280) widths, in dark and
// light theme, before/after the "No photo yet" fallback header is slimmed
// down. Confirms the Golden Thread price block sits above the fold after
// the fix. Shots land wherever OUT_DIR points (defaults to /tmp/shots-r4),
// a real software WebGL2 context (SwiftShader), on an isolated port.
import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";

const BASE = process.env.R4_BASE_URL ?? "http://localhost:3241";
const OUT = process.env.R4_OUT_DIR ?? "/tmp/shots-r4";
const ARNOS_ARMS_ID = "venue-xjf3n0";
const LABEL = process.env.R4_LABEL ?? "before"; // "before" | "after"

const ALL_VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 900 },
];
const VIEWPORTS = process.env.R4_VIEWPORT
  ? ALL_VIEWPORTS.filter((v) => v.name === process.env.R4_VIEWPORT)
  : ALL_VIEWPORTS;
const THEMES = process.env.R4_THEME ? [process.env.R4_THEME] : ["dark", "light"];

mkdirSync(OUT, { recursive: true });

async function captureOne(browser, viewport, theme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  try {
    await context.addInitScript((t) => {
      window.localStorage.setItem("pubmax-theme", t);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    const page = await context.newPage();
    let sheetVisible = false;
    for (let attempt = 0; attempt < 3 && !sheetVisible; attempt++) {
      await page.goto(`${BASE}/map?sel=${ARNOS_ARMS_ID}`, { waitUntil: "load", timeout: 60000 });
      await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 45000 });
      try {
        await page.locator(".venueInspector").waitFor({ state: "visible", timeout: 15000 });
        sheetVisible = true;
      } catch {
        console.log(`  retrying (venueInspector not visible, attempt ${attempt + 1})`);
      }
    }
    if (!sheetVisible) throw new Error("venue sheet never became visible after retries");
    await page.waitForTimeout(2500);

    const fname = `${LABEL}-${viewport.name}-${theme}.png`;
    await page.screenshot({ path: `${OUT}/${fname}` });

    // Measure fold position: does the Golden Thread price block's top land
    // within the viewport's visible height?
    const report = await page.evaluate(() => {
      const empty = document.querySelector(".venueImage--empty");
      const golden =
        document.querySelector(".venuePriceStory") ||
        document.querySelector(".venueTonightChips");
      const rect = (el) => (el ? el.getBoundingClientRect() : null);
      return {
        emptyHeaderRect: rect(empty),
        goldenRect: rect(golden),
        innerHeight: window.innerHeight,
      };
    });
    console.log(`[${LABEL}] ${viewport.name}x${theme}:`, JSON.stringify(report));
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        await captureOne(browser, viewport, theme);
      }
    }
  } finally {
    await browser.close();
  }
}

run().then(
  () => {
    console.log("R4 shots written to", OUT);
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
