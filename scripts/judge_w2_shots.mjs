// Design-judge wave 2 evidence — the overnight loop's exit test. Captures the
// six core mobile surfaces (landing, map, tonight, today, pal chat, feed) at
// 390x844 in BOTH themes, plus the two states the earlier passes fixed:
// location-denied Near me (/near with no geolocation permission) and the pal
// first-open glance (the default /pal/chat state, captured with the rest).
// Same SwiftShader WebGL2 setup as judge-w1 so the map really paints.
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
  // Location-denied Near me: the context below grants no geolocation
  // permission, so getCurrentPosition rejects and the remembered-patch
  // fallback (#427) is what renders.
  { slug: "near-denied", path: "/near", nearWait: true },
];

const SUFFIX = process.env.JUDGE_SUFFIX ?? "";
// SwiftShader paints tiles slowly; default map settle is fine for layout
// judgement, but a full-paint shot needs longer — override per run.
const MAP_WAIT_MS = Number(process.env.JUDGE_MAP_WAIT_MS ?? 3500);
// Optional comma-separated slug filter so a re-shoot doesn't redo the set.
const ONLY = process.env.JUDGE_ONLY ? process.env.JUDGE_ONLY.split(",") : null;

async function capture(browser, theme, { slug, path, scroll, mapWait, nearWait }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: theme,
    permissions: [],
  });
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
      await page.waitForTimeout(MAP_WAIT_MS);
    } else if (nearWait) {
      await page.locator(".nmnCard").first().waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(400);
    } else {
      await page.waitForTimeout(1800);
    }
    await page.screenshot({ path: `${OUT}/judge-w2-${slug}-${theme}-390${SUFFIX}.png` });
    if (scroll) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${OUT}/judge-w2-${slug}-scroll-${theme}-390${SUFFIX}.png` });
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
        if (ONLY && !ONLY.includes(surface.slug)) continue;
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
    console.log("Judge w2 shots written to", OUT);
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
