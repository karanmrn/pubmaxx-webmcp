// C2 screenshot gate — the active plan drawn on the map as a route line +
// ordered stop markers, through the EXISTING crawl route paint (route-line /
// route-stops in components/map/canvas/buildScene).
//
//   • BEFORE = /map with NO active plan. My change is honest-empty, so this is
//     behaviourally identical to pre-C2 main: no overlay. It proves the feature
//     adds nothing when nothing is on tonight.
//   • AFTER  = /map with an active plan pointer set (lib/activePlan) and the
//     /api/plans/[id] response mocked to a 3-stop Soho crawl. The map resolves
//     those stops against its live venue index and draws them through the same
//     paint the crawl planner uses — brass route line + numbered stop pins,
//     framed by the existing routeKey→fitRoute camera effect.
//
// Both across desktop (1280) + mobile (390), dark + light. Shots land in
// OUT_DIR (defaults to /tmp/shots-c2), on a real software WebGL2 context
// (SwiftShader), against an already-running server.
import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";

const BASE = process.env.C2_BASE_URL ?? "http://localhost:3242";
const OUT = process.env.C2_OUT_DIR ?? "/tmp/shots-c2";

// A valid plan id (lib/plan.isPlanId — UUID v1-8) and four dataset-pinned pubs
// spread Soho → Covent Garden → Holborn → Clerkenwell (~2 km), all present in
// public/data/venues_slim.json so they resolve to real, locatable pins and the
// route line + numbered stops read clearly at the framed zoom.
const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const STOPS = [
  { venueId: "venue-15i2wst", venueName: "Golden Lion (Soho)", position: 0 },
  { venueId: "venue-11bllvc", venueName: "Punch & Judy", position: 1 },
  { venueId: "venue-1vle947", venueName: "The Sir Christopher Hatton", position: 2 },
  { venueId: "venue-13sug69", venueName: "The Crown Tavern", position: 3 },
];

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 900 },
];
const THEMES = ["dark", "light"];

mkdirSync(OUT, { recursive: true });

function planState(startTimeIso) {
  return {
    plan: { id: PLAN_ID, title: "Soho tonight", startTime: startTimeIso, createdAt: startTimeIso },
    stops: STOPS,
    crew: [],
  };
}

async function captureOne(browser, label, viewport, theme) {
  const withPlan = label === "after";
  const startTimeIso = new Date().toISOString(); // inside the active window
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  let planApiHits = 0;
  const consoleErrors = [];
  try {
    await context.addInitScript(
      ({ t, plan, id, startTime }) => {
        window.localStorage.setItem("pubmax-theme", t);
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        if (plan) {
          window.localStorage.setItem(
            "pubmax_active_plan",
            JSON.stringify({ id, startTime, stopIndex: 0 }),
          );
          // Dismiss the app-shell Night Mode card (components/night) for THIS
          // plan so it doesn't cover the map — we're shooting the map overlay,
          // not the shell chrome (a parallel lane owns that surface).
          window.sessionStorage.setItem(`pubmax:night-mode-dismissed:${id}`, "1");
        } else {
          window.localStorage.removeItem("pubmax_active_plan");
        }
      },
      { t: theme, plan: withPlan, id: PLAN_ID, startTime: startTimeIso },
    );

    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // Mock the plan fetch so the overlay is deterministic without Supabase.
    await page.route("**/api/plans/**", async (route) => {
      const url = route.request().url();
      if (url.includes(PLAN_ID) && !url.includes("/getin") && !url.includes("/presence")) {
        planApiHits += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(planState(startTimeIso)),
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });

    await page.goto(`${BASE}/map`, { waitUntil: "load", timeout: 60000 });
    await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 45000 });
    await page.locator(".maplibreMap canvas").first().waitFor({ state: "visible", timeout: 45000 });
    // The plan route only resolves once the slim venue index is loaded (the plan
    // stops resolve against it). Wait for the first-pins mark so we never shoot
    // the overlay before its geometry can exist — this removes the warmup race
    // where the mocked plan fetch lands before the venues do.
    await page
      .waitForFunction(
        () => (performance.getEntriesByName("pubmax:first-pins")[0]?.startTime ?? 0) > 0,
        { timeout: 30000 },
      )
      .catch(() => {});
    if (withPlan) {
      // Wait until the map wrapper reports the resolved plan route (its stop
      // count) — deterministic proof the plan fetch landed AND resolved to real
      // pins, so we never shoot before the overlay's geometry exists.
      await page
        .waitForFunction(
          () => Number(document.querySelector(".mapCanvasWrap")?.getAttribute("data-route-stops") ?? "0") >= 2,
          { timeout: 20000 },
        )
        .catch(() => {});
    }
    // Then let the setData paint, the fitRoute framing, and the brass dash
    // animation settle before the shot.
    await page.waitForTimeout(withPlan ? 5000 : 3500);

    const routeStopsAttr = await page.evaluate(
      () => document.querySelector(".mapCanvasWrap")?.getAttribute("data-route-stops") ?? "?",
    );
    const fname = `${label}-${viewport.name}-${theme}.png`;
    await page.screenshot({ path: `${OUT}/${fname}` });
    console.log(
      `[${label}] ${viewport.name}x${theme}: routeStopsAttr=${routeStopsAttr} planApiHits=${planApiHits} consoleErrors=${consoleErrors.length}` +
        (consoleErrors.length ? `\n    ${consoleErrors.join("\n    ")}` : ""),
    );
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    for (const label of ["before", "after"]) {
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          await captureOne(browser, label, viewport, theme);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

run().then(
  () => {
    console.log("C2 shots written to", OUT);
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
