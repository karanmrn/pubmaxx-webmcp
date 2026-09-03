import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  UI_UX_MOTION_POLICY,
  UI_UX_PAGE_SCREENSHOT_OPTIONS,
  assertUiUxCurrentFocus,
  assertUiUxVisibleFocusIndicator,
  hasResolvedUnconfiguredAuth,
  uiUxAuditContextOptions,
  uiUxChromiumLaunchOptions,
} from "./lib/uiUxBattleTestBrowser.mjs";
import {
  AUDITED_ROUTES,
  UI_UX_CLS_BUDGET,
  configureAuditedFlowsForRunMode,
  navigateToAuditedRoute,
  selectAuditedFlows,
  selectAuditedOrigins,
  selectAuditedRoutes,
  waitForAuditedRouteSettlement,
} from "./lib/uiUxBattleTestNavigation.mjs";
import { assertCompleteUiUxAudit } from "./lib/uiUxBattleTestCompletion.mjs";
import { prepareAuditOutputRoot } from "./lib/uiUxBattleTestOutput.mjs";

const colorScheme = process.env.UI_UX_COLOR_SCHEME ?? "light";
const browserChannel = process.env.UI_UX_BROWSER_CHANNEL;
const frozenLiveBaselineValue = process.env.UI_UX_FROZEN_LIVE_BASELINE;
if (frozenLiveBaselineValue !== undefined && frozenLiveBaselineValue !== "1") {
  throw new Error("UI_UX_FROZEN_LIVE_BASELINE must be 1 when set");
}
const frozenLiveBaseline = frozenLiveBaselineValue === "1";
const selectedOrigins = selectAuditedOrigins(process.env.UI_UX_ORIGINS);
const selectedRoutes = selectAuditedRoutes(process.env.UI_UX_ROUTES);
const selectedFlows = configureAuditedFlowsForRunMode(
  selectAuditedFlows(selectedRoutes),
  { frozenLiveBaseline },
);
const outputRoot = await prepareAuditOutputRoot(process.env.UI_UX_OUTPUT);
const viewports = [
  {
    name: "mobile-390",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "desktop-1440",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
];
const browser = await chromium.launch(uiUxChromiumLaunchOptions(browserChannel));
const findings = [];
const pages = [];
const flows = [];

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
}

function addFinding(finding) {
  findings.push(finding);
}

async function inspectPage(page, origin, viewport, route) {
  const result = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const interactive = [...document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
    )]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.getAttribute("aria-label") || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100),
          type: element.getAttribute("type") || "",
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          x: Math.round(rect.x * 10) / 10,
          y: Math.round(rect.y * 10) / 10,
          overflowX: style.overflowX,
          opacity: style.opacity,
          outline: style.outline,
        };
      });
    const textOverflow = [...document.querySelectorAll("body *")]
      .filter(visible)
      .filter((element) => element.children.length === 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          rectWidth: rect.width,
        };
      })
      .filter((item) => item.scrollWidth > item.clientWidth + 1);
    const safeAreaConsumers = [
      [".siteNavBar:not(.siteNavBarFloating)", "marginTop"],
      [".siteNavBarFloating", "top"],
      [".lpNav", "top"],
      [".mobileTabBar", "paddingBottom"],
    ]
      .flatMap(([selector, property]) =>
        [...document.querySelectorAll(selector)]
          .filter(visible)
          .map((element) => ({
            selector,
            property,
            value: getComputedStyle(element)[property],
          })),
      );
    const layoutStability = window.__pubmaxUiUxAuditMetrics ?? {
      cls: 0,
      supported: false,
    };
    return {
      url: location.href,
      title: document.title,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body?.scrollWidth ?? 0,
      interactive,
      textOverflow,
      safeAreaConsumers,
      cls: layoutStability.supported ? layoutStability.cls : null,
      clsSupported: layoutStability.supported,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    };
  });

  const prefix = `${origin.name}/${viewport.name}/${route.name}`;
  await page.screenshot({
    path: path.join(outputRoot, `${safeName(prefix)}.png`),
    ...UI_UX_PAGE_SCREENSHOT_OPTIONS,
  });
  pages.push({
    prefix,
    origin: origin.name,
    viewport: viewport.name,
    routeName: route.name,
    route: route.path,
    ...result,
  });

  if (viewport.isMobile) {
    for (const element of result.interactive) {
      if (element.width < 44 || element.height < 44) {
        addFinding({
          severity: "high",
          category: "tap-target",
          origin: origin.name,
          viewport: viewport.name,
          route: route.path,
          element: `${element.tag} ${element.text || element.type || "unnamed"}`,
          defect: `Interactive target is ${element.width}x${element.height}px, below 44x44 CSS px.`,
          evidence: `${safeName(prefix)}.png`,
        });
      }
    }
  }
  if (result.scrollWidth > result.clientWidth + 1 || result.bodyScrollWidth > result.clientWidth + 1) {
    addFinding({
      severity: "high",
      category: "overflow",
      origin: origin.name,
      viewport: viewport.name,
      route: route.path,
      element: "document",
      defect: `Horizontal overflow: document ${result.scrollWidth}px, body ${result.bodyScrollWidth}px, viewport ${result.clientWidth}px.`,
      evidence: `${safeName(prefix)}.png`,
    });
  }
  if (result.textOverflow.length > 0) {
    addFinding({
      severity: "medium",
      category: "text-overflow",
      origin: origin.name,
      viewport: viewport.name,
      route: route.path,
      element: result.textOverflow.slice(0, 5).map((item) => `${item.tag} ${item.text}`).join(" | "),
      defect: `${result.textOverflow.length} visible text node(s) have scrollWidth greater than clientWidth.`,
      evidence: `${safeName(prefix)}.png`,
    });
  }
}

async function navigate(page, origin, viewport, route) {
  try {
    const result = await navigateToAuditedRoute(page, origin.url, route);
    if (result.cls !== null && result.cls >= UI_UX_CLS_BUDGET) {
      addFinding({
        severity: "high",
        category: "layout-stability",
        origin: origin.name,
        viewport: viewport.name,
        route: route.path,
        element: "document",
        defect: `CLS ${result.cls.toFixed(4)} exceeds the ${UI_UX_CLS_BUDGET} budget.`,
        evidence: `${safeName(`${origin.name}/${viewport.name}/${route.name}`)}.png`,
      });
    }
    return result;
  } catch (error) {
    addFinding({
      severity: "high",
      category: "navigation",
      origin: origin.name,
      viewport: viewport.name,
      route: route.path,
      element: "document",
      defect: `Navigation failed: ${error.message}`,
      evidence: "navigation",
    });
    return null;
  }
}

function auditedRoute(name) {
  const route = AUDITED_ROUTES.find((candidate) => candidate.name === name);
  if (!route) throw new Error(`Missing audited route: ${name}`);
  return route;
}

async function requireVisibleFocus(page, locator, label) {
  await locator.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await assertUiUxCurrentFocus(locator, label);
  await assertUiUxVisibleFocusIndicator(locator, label);
}

async function paintedMapPoints(page) {
  return page.evaluate(() => window.__pubmaxPaintedMapTapPoints?.() ?? []);
}

function paintedPointSignature(points) {
  return points
    .map(({ id, x, y }) => `${id}:${Math.round(x)}:${Math.round(y)}`)
    .sort()
    .join("|");
}

async function waitForPaintedPointChange(page, previous) {
  await page.waitForFunction((prior) => {
    const points = window.__pubmaxPaintedMapTapPoints?.() ?? [];
    const next = points
      .map(({ id, x, y }) => `${id}:${Math.round(x)}:${Math.round(y)}`)
      .sort()
      .join("|");
    return points.length > 0 && next !== prior;
  }, previous);
}

async function exerciseNamedFlows(origin, viewport, auditedFlows) {
  if (auditedFlows.length === 0) return;
  const enabled = new Set(auditedFlows.map(({ name }) => name));
  const flowPage = await browser.newPage({
    viewport: viewport.viewport,
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    colorScheme,
    ...uiUxAuditContextOptions(origin.url),
  });
  await flowPage.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const runFlow = async (name, route, action) => {
    try {
      await navigateToAuditedRoute(flowPage, origin.url, route);
      const outcome = await action();
      if (outcome === "not-applicable") return;
      flows.push({ name, origin: origin.name, viewport: viewport.name, status: "passed" });
    } catch (error) {
      flows.push({
        name,
        origin: origin.name,
        viewport: viewport.name,
        status: "failed",
        error: error.message,
      });
      addFinding({
        severity: "high",
        category: "key-flow",
        origin: origin.name,
        viewport: viewport.name,
        route: route.path,
        element: name,
        defect: `${name} failed: ${error.message}`,
        evidence: `${origin.name}-${viewport.name}-key-flow.png`,
      });
    }
  };

  if (enabled.has("login-sheet-open") && !viewport.isMobile) {
    await runFlow("login-sheet-open", auditedRoute("home"), async () => {
      const trigger = flowPage.getByRole("button", { name: "Sign in", exact: true }).first();
      if (!await trigger.isVisible()) {
        if (!await hasResolvedUnconfiguredAuth(flowPage)) {
          throw new Error("Sign in trigger unavailable while auth is configured or unresolved");
        }
        flows.push({
          name: "login-sheet-open",
          origin: origin.name,
          viewport: viewport.name,
          status: "not-applicable",
          reason: "sign-in-trigger-unavailable",
          authConfigured: false,
        });
        return "not-applicable";
      }
      await requireVisibleFocus(flowPage, trigger, "Sign in trigger");
      await trigger.press("Enter");
      const sheet = flowPage.locator('.authMenu[aria-label="Sign in options"]');
      await sheet.waitFor({ state: "visible" });
      const firstEnabled = sheet
        .locator("button:not(:disabled), input:not(:disabled), [href]")
        .first();
      await firstEnabled.waitFor({ state: "visible" });
      try {
        await assertUiUxCurrentFocus(firstEnabled, "Sign in sheet control");
      } catch (error) {
        if (origin.name !== "live" || !frozenLiveBaseline) throw error;
        flows.push({
          name: "login-sheet-open",
          origin: origin.name,
          viewport: viewport.name,
          status: "not-applicable",
          reason: "frozen-live-autofocus-unavailable",
          frozenLiveBaseline: true,
        });
        return "not-applicable";
      }
      await assertUiUxVisibleFocusIndicator(firstEnabled, "Sign in sheet control");
    });
  } else if (enabled.has("login-sheet-open")) {
    flows.push({
      name: "login-sheet-open",
      origin: origin.name,
      viewport: viewport.name,
      status: "not-applicable",
      reason: "desktop-popover-only",
    });
  }

  if (enabled.has("tonight-browse")) {
    await runFlow("tonight-browse", auditedRoute("tonight"), async () => {
      const browse = flowPage.getByRole("link", { name: "See them on the map" });
      await requireVisibleFocus(flowPage, browse, "Tonight browse link");
      await browse.click();
      await flowPage.waitForURL((url) => url.pathname.startsWith("/map"));
      await waitForAuditedRouteSettlement(flowPage, auditedRoute("map"));
    });
  }

  if (enabled.has("near-answer")) {
    await runFlow("near-answer", auditedRoute("near"), async () => {
      const soho = flowPage.getByRole("button", { name: "Soho", exact: true }).first();
      await requireVisibleFocus(flowPage, soho, "Soho area choice");
      await soho.click();
      await flowPage.locator(".nmnHead").waitFor({ state: "visible" });
      await flowPage.waitForURL((url) => url.searchParams.get("patch") === "soho");
    });
  }

  if (enabled.has("add-form-open")) {
    await runFlow("add-form-open", auditedRoute("add"), async () => {
      const form = flowPage.locator('.confirmFollow[aria-label="Add @karan"]');
      await form.waitFor({ state: "visible" });
      await requireVisibleFocus(
        flowPage,
        form.locator(".confirmFollowPrimary"),
        "Add form primary action",
      );
    });
  }

  if (enabled.has("map-pan-zoom") && !viewport.isMobile) {
    await runFlow("map-pan-zoom", auditedRoute("map"), async () => {
      const zoomIn = flowPage.getByRole("button", { name: "Zoom in" });
      await requireVisibleFocus(flowPage, zoomIn, "Map zoom in");
      const beforeZoom = paintedPointSignature(await paintedMapPoints(flowPage));
      await zoomIn.click();
      await waitForPaintedPointChange(flowPage, beforeZoom);

      const canvas = flowPage.locator(".maplibreMap canvas");
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Map canvas has no visible bounds");
      const beforePan = paintedPointSignature(await paintedMapPoints(flowPage));
      await flowPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await flowPage.mouse.down();
      await flowPage.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, {
        steps: 8,
      });
      await flowPage.mouse.up();
      await waitForPaintedPointChange(flowPage, beforePan);
      await requireVisibleFocus(
        flowPage,
        flowPage.getByRole("button", { name: "Zoom out" }),
        "Map zoom out",
      );
    });
  } else if (enabled.has("map-pan-zoom")) {
    flows.push({
      name: "map-pan-zoom",
      origin: origin.name,
      viewport: viewport.name,
      status: "not-applicable",
      reason: "desktop-zoom-controls-only",
    });
  }

  await flowPage.screenshot({
    path: path.join(outputRoot, `${origin.name}-${viewport.name}-key-flow.png`),
  });
  await flowPage.close();
}

for (const origin of selectedOrigins) {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: viewport.viewport,
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      colorScheme,
      serviceWorkers: "block",
      ...uiUxAuditContextOptions(origin.url),
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => addFinding({
      severity: "medium",
      category: "runtime",
      origin: origin.name,
      viewport: viewport.name,
      route: page.url(),
      element: "page",
      defect: `Page error: ${error.message}`,
      evidence: "console",
    }));
    for (const route of selectedRoutes) {
      if (!await navigate(page, origin, viewport, route)) continue;
      try {
        await inspectPage(page, origin, viewport, route);
      } catch (error) {
        await page.waitForTimeout(500);
        try {
          await inspectPage(page, origin, viewport, route);
        } catch (retryError) {
          addFinding({
            severity: "medium",
            category: "audit",
            origin: origin.name,
            viewport: viewport.name,
            route: route.path,
            element: "document",
            defect: `Audit capture failed after retry: ${retryError.message || error.message}`,
            evidence: "audit.json",
          });
        }
      }
    }
    await page.close();
    await context.close();
    await exerciseNamedFlows(origin, viewport, selectedFlows);
  }
}

await Promise.race([
  browser.close(),
  new Promise((resolve) => setTimeout(resolve, 5_000)),
]);
const audit = {
  clsBudget: UI_UX_CLS_BUDGET,
  motionPolicy: UI_UX_MOTION_POLICY,
  runMode: { frozenLiveBaseline },
  pages,
  flows,
  findings,
};
await fs.writeFile(
  path.join(outputRoot, "audit.json"),
  JSON.stringify(audit, null, 2),
);
assertCompleteUiUxAudit({
  originNames: selectedOrigins.map(({ name }) => name),
  viewportNames: viewports.map(({ name }) => name),
  routeNames: selectedRoutes.map(({ name }) => name),
  flowDefinitions: selectedFlows,
  clsBudget: audit.clsBudget,
  motionPolicy: audit.motionPolicy,
  pages,
  flowResults: flows,
});
console.log(JSON.stringify({ outputRoot, pageCount: pages.length, findingCount: findings.length }, null, 2));
