#!/usr/bin/env node
/*
 * perf-baseline.mjs — Mobile V1 performance baseline harness.
 *
 * Gates every subsequent fix lane: each lane attaches its before/after delta
 * measured by THIS script, so the method must be fixed and reproducible.
 *
 * WHAT IT MEASURES
 *   1. Lighthouse (mobile form factor, 4x CPU slowdown, simulated Slow-4G) for
 *      the five core routes — /, /map, /today, /tonight, /plan — 3 runs each,
 *      reporting the MEDIAN of LCP / TBT / CLS / TTI (+ FCP and perf score).
 *   2. A Playwright tab-transition probe: from /today, tap each MobileTabBar
 *      destination and measure tap -> first painted frame of the target route
 *      against the <300ms transition budget (median of N runs).
 *
 * Output: a dated JSON + a human-readable markdown table under
 *   pubmax-wave-screenshots/perf/perf-baseline-<target>-<YYYY-MM-DD>.{json,md}
 *
 * USAGE (one command)
 *   # Production (the default; what the wave baseline is taken against):
 *   node scripts/perf-baseline.mjs --target prod
 *
 *   # A local isolated production build the harness builds + serves itself:
 *   node scripts/perf-baseline.mjs --target local
 *
 *   # A local/remote server you are already running (skips build+serve):
 *   node scripts/perf-baseline.mjs --target local --base-url http://localhost:3200
 *
 *   Flags: --runs <n> (Lighthouse runs/route, default 3)
 *          --transition-runs <n> (probe runs/tab, default 5)
 *          --out <dir> (default pubmax-wave-screenshots/perf)
 *          --port <n> (auto build+serve port, default 3200)
 *          --skip-lighthouse | --skip-transitions
 *
 * Requirements: Chrome/Chromium on PATH for Lighthouse; `npm ci` done (Playwright
 * chromium). Lighthouse is invoked via `npx lighthouse` (no repo dependency add).
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Config ────────────────────────────────────────────────────────────────
const PROD_BASE_URL = "https://pubmaxxing.com";

// The five core routes for the Lighthouse baseline (owner-specified).
const LIGHTHOUSE_ROUTES = ["/", "/map", "/today", "/tonight", "/plan"];

// MobileTabBar destinations tapped FROM /today. Moment (/moment) is a create
// action, not a navigation, and Today is the origin — both are excluded. Labels
// mirror components/nav/navigationModel.ts + MobileTabBar.tsx.
const TAB_TRANSITIONS = [
  { key: "map", label: "Map", targetPrefix: "/map" },
  { key: "tonight", label: "Tonight", targetPrefix: "/tonight" },
  { key: "stories", label: "Stories", targetPrefix: "/feed" },
  { key: "you", label: "You", targetPrefix: "/u" },
];

const TRANSITION_BUDGET_MS = 300;
const MOBILE_VIEWPORT = { width: 390, height: 844 };
// Lighthouse's mobile "Slow 4G" simulate preset, pinned explicitly so the
// numbers are stable across Lighthouse versions and self-documenting.
const THROTTLING = {
  cpuSlowdownMultiplier: 4,
  rttMs: 150,
  throughputKbps: 1638.4,
  requestLatencyMs: 562.5,
  downloadThroughputKbps: 1474.56,
  uploadThroughputKbps: 675,
};

// ── Arg parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    target: "prod",
    baseUrl: null,
    runs: 3,
    transitionRuns: 5,
    out: path.join(REPO_ROOT, "pubmax-wave-screenshots", "perf"),
    port: 3200,
    skipLighthouse: false,
    skipTransitions: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--target": args.target = next(); break;
      case "--base-url": args.baseUrl = next(); break;
      case "--runs": args.runs = Number(next()); break;
      case "--transition-runs": args.transitionRuns = Number(next()); break;
      case "--out": args.out = path.resolve(next()); break;
      case "--port": args.port = Number(next()); break;
      case "--skip-lighthouse": args.skipLighthouse = true; break;
      case "--skip-transitions": args.skipTransitions = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.target !== "prod" && args.target !== "local") {
    throw new Error(`--target must be prod|local, got ${args.target}`);
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error("--runs must be >= 1");
  if (!Number.isInteger(args.transitionRuns) || args.transitionRuns < 1) {
    throw new Error("--transition-runs must be >= 1");
  }
  return args;
}

// ── Small utils ─────────────────────────────────────────────────────────────
const log = (...a) => console.log("[perf-baseline]", ...a);

function median(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (v, dp = 0) =>
  v === null || v === undefined ? null : Number(v.toFixed(dp));

function fmt(v, unit) {
  if (v === null || v === undefined) return "n/a";
  return unit === "ms" ? `${Math.round(v)} ms` : unit === "" ? v.toFixed(3) : `${v}${unit}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

// ── Local isolated build + serve ─────────────────────────────────────────────
async function startLocalServer(port) {
  if (!(await portFree(port))) {
    throw new Error(`Port ${port} is already in use — pass --base-url to reuse a running server.`);
  }
  const distDir = ".next-perf-baseline";
  log(`Building isolated production build (NEXT_DIST_DIR=${distDir})…`);
  await runToCompletion("node", ["scripts/run-with-restored-next-env.mjs", "npm", "run", "build"], {
    env: { ...process.env, NEXT_DIST_DIR: distDir },
  });
  log(`Starting production server on :${port}…`);
  const child = spawn("npm", ["run", "start", "--", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env, NEXT_DIST_DIR: distDir },
    stdio: "ignore",
  });
  const baseUrl = `http://localhost:${port}`;
  await waitForServer(baseUrl);
  log("Local server ready.");
  return { baseUrl, stop: () => { try { child.kill("SIGTERM"); } catch { /* already gone */ } } };
}

function runToCompletion(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
  });
}

// ── Lighthouse ────────────────────────────────────────────────────────────────
function runLighthouseOnce(url) {
  return new Promise((resolve, reject) => {
    const args = [
      "--yes", "lighthouse", url,
      "--quiet",
      "--output=json",
      "--output-path=stdout",
      "--only-categories=performance",
      "--form-factor=mobile",
      "--screenEmulation.mobile",
      `--screenEmulation.width=${MOBILE_VIEWPORT.width}`,
      `--screenEmulation.height=${MOBILE_VIEWPORT.height}`,
      "--screenEmulation.deviceScaleFactor=2",
      "--throttling-method=simulate",
      `--throttling.cpuSlowdownMultiplier=${THROTTLING.cpuSlowdownMultiplier}`,
      `--throttling.rttMs=${THROTTLING.rttMs}`,
      `--throttling.throughputKbps=${THROTTLING.throughputKbps}`,
      `--throttling.requestLatencyMs=${THROTTLING.requestLatencyMs}`,
      `--throttling.downloadThroughputKbps=${THROTTLING.downloadThroughputKbps}`,
      `--throttling.uploadThroughputKbps=${THROTTLING.uploadThroughputKbps}`,
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
    ];
    const child = spawn("npx", args, { cwd: REPO_ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`lighthouse exited ${code}: ${stderr.slice(-500)}`));
      try {
        const json = JSON.parse(stdout);
        const a = json.audits ?? {};
        resolve({
          lcp: a["largest-contentful-paint"]?.numericValue ?? null,
          tbt: a["total-blocking-time"]?.numericValue ?? null,
          cls: a["cumulative-layout-shift"]?.numericValue ?? null,
          tti: a["interactive"]?.numericValue ?? null,
          fcp: a["first-contentful-paint"]?.numericValue ?? null,
          score: json.categories?.performance?.score != null
            ? json.categories.performance.score * 100
            : null,
        });
      } catch (err) {
        reject(new Error(`Failed to parse Lighthouse JSON: ${err.message}`));
      }
    });
  });
}

async function runLighthouseSuite(baseUrl, routes, runs) {
  const results = {};
  for (const route of routes) {
    const url = new URL(route, baseUrl).toString();
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      log(`Lighthouse ${route} run ${i + 1}/${runs}…`);
      try {
        samples.push(await runLighthouseOnce(url));
      } catch (err) {
        log(`  run failed: ${err.message}`);
        samples.push(null);
      }
    }
    const ok = samples.filter(Boolean);
    results[route] = {
      url,
      runs: samples.length,
      okRuns: ok.length,
      median: {
        lcp: round(median(ok.map((s) => s.lcp))),
        tbt: round(median(ok.map((s) => s.tbt))),
        cls: round(median(ok.map((s) => s.cls)), 3),
        tti: round(median(ok.map((s) => s.tti))),
        fcp: round(median(ok.map((s) => s.fcp))),
        score: round(median(ok.map((s) => s.score))),
      },
      samples: ok,
    };
  }
  return results;
}

// ── Playwright tab-transition probe ───────────────────────────────────────────
async function runTransitionProbe(baseUrl, runs) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const results = {};
  try {
    for (const tab of TAB_TRANSITIONS) {
      const deltas = [];
      for (let i = 0; i < runs; i += 1) {
        const context = await browser.newContext({
          viewport: MOBILE_VIEWPORT,
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();
        try {
          await page.goto(new URL("/today", baseUrl).toString(), { waitUntil: "domcontentloaded" });
          // The tab bar is mobile-only chrome; make sure it is mounted first.
          const tabBar = page.locator(".mobileTabBar");
          await tabBar.waitFor({ state: "visible", timeout: 15_000 });
          const link = tabBar.locator(`a[href^="${tab.targetPrefix}"]`).first();
          await link.waitFor({ state: "visible", timeout: 10_000 });

          const tap = Date.now();
          await link.click();
          // First painted frame of the target route: URL commit, then two rAF.
          await page.waitForURL((u) => u.pathname.startsWith(tab.targetPrefix), { timeout: 15_000 });
          await page.evaluate(
            () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))),
          );
          deltas.push(Date.now() - tap);
        } catch (err) {
          log(`  transition /today -> ${tab.targetPrefix} run ${i + 1} failed: ${err.message}`);
          deltas.push(null);
        } finally {
          await context.close();
        }
      }
      const med = round(median(deltas));
      results[tab.key] = {
        label: tab.label,
        from: "/today",
        targetPrefix: tab.targetPrefix,
        runs: deltas.length,
        samplesMs: deltas,
        medianMs: med,
        budgetMs: TRANSITION_BUDGET_MS,
        withinBudget: med !== null ? med <= TRANSITION_BUDGET_MS : null,
      };
      log(`Transition /today -> ${tab.label}: median ${med ?? "n/a"} ms (budget ${TRANSITION_BUDGET_MS})`);
    }
  } finally {
    await browser.close();
  }
  return results;
}

// ── Report rendering ──────────────────────────────────────────────────────────
function renderMarkdown({ target, baseUrl, runs, transitionRuns, generatedAt, lighthouse, transitions }) {
  const lines = [];
  lines.push(`# Mobile V1 performance baseline — ${target}`);
  lines.push("");
  lines.push(`- Target: \`${baseUrl}\``);
  lines.push(`- Generated: ${generatedAt}`);
  lines.push(`- Method: Lighthouse mobile, ${THROTTLING.cpuSlowdownMultiplier}x CPU, simulated Slow-4G (rtt ${THROTTLING.rttMs}ms / ${THROTTLING.throughputKbps}kbps). Medians of ${runs} runs/route.`);
  lines.push("");

  if (lighthouse) {
    lines.push("## Lighthouse core routes (median)");
    lines.push("");
    lines.push("| Route | LCP | TBT | CLS | TTI | FCP | Perf | runs |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const route of LIGHTHOUSE_ROUTES) {
      const r = lighthouse[route];
      if (!r) continue;
      const m = r.median;
      lines.push(
        `| \`${route}\` | ${fmt(m.lcp, "ms")} | ${fmt(m.tbt, "ms")} | ${fmt(m.cls, "")} | ${fmt(m.tti, "ms")} | ${fmt(m.fcp, "ms")} | ${m.score ?? "n/a"} | ${r.okRuns}/${r.runs} |`,
      );
    }
    lines.push("");
  }

  if (transitions) {
    lines.push(`## Tab transitions from /today (median of ${transitionRuns} runs, budget ${TRANSITION_BUDGET_MS}ms)`);
    lines.push("");
    lines.push("| Tap | Target | Median | Budget | Within? |");
    lines.push("|---|---|---:|---:|:---:|");
    for (const tab of TAB_TRANSITIONS) {
      const t = transitions[tab.key];
      if (!t) continue;
      const within = t.withinBudget === null ? "n/a" : t.withinBudget ? "✅" : "❌";
      lines.push(`| ${t.label} | \`${t.targetPrefix}\` | ${fmt(t.medianMs, "ms")} | ${t.budgetMs} ms | ${within} |`);
    }
    lines.push("");
  }
  lines.push("_Every fix lane attaches its before/after delta measured by `scripts/perf-baseline.mjs`._");
  lines.push("");
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  let baseUrl = args.baseUrl;
  let stopServer = null;

  if (!baseUrl) {
    if (args.target === "prod") {
      baseUrl = PROD_BASE_URL;
    } else {
      const started = await startLocalServer(args.port);
      baseUrl = started.baseUrl;
      stopServer = started.stop;
    }
  }
  log(`Target: ${args.target} (${baseUrl})`);

  let lighthouse = null;
  let transitions = null;
  try {
    if (!args.skipLighthouse) {
      lighthouse = await runLighthouseSuite(baseUrl, LIGHTHOUSE_ROUTES, args.runs);
    }
    if (!args.skipTransitions) {
      transitions = await runTransitionProbe(baseUrl, args.transitionRuns);
    }
  } finally {
    if (stopServer) stopServer();
  }

  const generatedAt = new Date().toISOString();
  const dateStamp = generatedAt.slice(0, 10);
  const report = {
    schema: "pubmax-perf-baseline/v1",
    target: args.target,
    baseUrl,
    generatedAt,
    method: {
      tool: "lighthouse",
      formFactor: "mobile",
      throttling: THROTTLING,
      lighthouseRunsPerRoute: args.runs,
      transitionRunsPerTab: args.transitionRuns,
      transitionBudgetMs: TRANSITION_BUDGET_MS,
    },
    lighthouse,
    transitions,
  };

  await mkdir(args.out, { recursive: true });
  const base = path.join(args.out, `perf-baseline-${args.target}-${dateStamp}`);
  await writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = renderMarkdown({
    target: args.target, baseUrl, runs: args.runs, transitionRuns: args.transitionRuns,
    generatedAt, lighthouse, transitions,
  });
  await writeFile(`${base}.md`, markdown);

  log(`Wrote ${base}.json`);
  log(`Wrote ${base}.md`);
  console.log(`\n${markdown}`);
}

main().catch((err) => {
  console.error("[perf-baseline] FAILED:", err.stack || err.message);
  process.exit(1);
});
