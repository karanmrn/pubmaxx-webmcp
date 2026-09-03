// Design-judge wave 1 evidence — captures the six core mobile surfaces
// (landing, map, tonight, today, pal chat, feed) at 390x844 in BOTH themes,
// with a real software WebGL2 context (SwiftShader) for the map, on an
// isolated port. Landing also gets a below-the-fold scroll shot per theme.
// Shots land in docs/screenshots/ (resolved from this file, not the cwd).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const BASE = process.env.JUDGE_BASE_URL ?? "http://localhost:3199";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs/screenshots");

const SURFACES = [
  { slug: "landing", path: "/", scroll: true },
  { slug: "map", path: "/map/london", mapWait: true },
  { slug: "tonight", path: "/tonight" },
  { slug: "today", path: "/today" },
  { slug: "pal-chat", path: "/pal/chat" },
  { slug: "feed", path: "/feed" },
];

const SUFFIX = process.env.JUDGE_SUFFIX ?? "";

async function capture(browser, theme, { slug, path, scroll, mapWait }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.addInitScript((mode) => {
      window.localStorage.setItem("pubmax-theme", mode);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    const page = await context.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    if (mapWait) {
      await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(3500);
    } else {
      await page.waitForTimeout(1800);
    }
    await page.screenshot({ path: `${OUT}/judge-w1-${slug}-${theme}-390${SUFFIX}.png` });
    if (scroll) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/judge-w1-${slug}-scroll-${theme}-390${SUFFIX}.png` });
    }
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    for (const theme of ["dark", "light"]) {
      for (const surface of SURFACES) {
        await capture(browser, theme, surface);
        console.log(`captured ${surface.slug} ${theme}`);
      }
    }
  } finally {
    await browser.close();
  }
}

run().then(
  () => {
    console.log("Judge w1 shots written to", OUT);
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
