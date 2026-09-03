// Judge-w1 wave-2 evidence — feed density + pal first-open glance, 390x844,
// both themes. Same idiom as judge_w1_shots.mjs (isolated port, theme via
// localStorage init script); the two changed surfaces only. Suffix "-after"
// via WAVE2_SUFFIX distinguishes post-change captures; the pre-change state is
// the committed judge-w1 pair from #428.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const BASE = process.env.WAVE2_BASE_URL ?? "http://localhost:3199";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs/screenshots");
const SUFFIX = process.env.WAVE2_SUFFIX ?? "";

const SURFACES = [
  { slug: "feed", path: "/feed" },
  { slug: "pal", path: "/pal/chat" },
];

async function capture(browser, theme, { slug, path }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.addInitScript((mode) => {
      window.localStorage.setItem("pubmax-theme", mode);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    const page = await context.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    // Long enough for the pal glance fetch + fade to settle.
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `${OUT}/wave2-${slug}-${theme}-390${SUFFIX}.png` });
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  for (const theme of ["light", "dark"]) {
    for (const surface of SURFACES) {
      await capture(browser, theme, surface);
      console.log(`shot wave2-${surface.slug}-${theme}-390${SUFFIX}`);
    }
  }
} finally {
  await browser.close();
}
