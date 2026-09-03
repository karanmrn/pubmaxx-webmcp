import { isLocalUiUxAuditOrigin } from "./uiUxBattleTestBrowser.mjs";

export const AUDITED_ORIGINS = [
  { name: "live", url: "https://pubmaxxing.com" },
  { name: "local", url: "http://localhost:3000" },
];

export const UI_UX_CLS_BUDGET = 0.1;

export const AUDITED_ROUTES = [
  { name: "home", path: "/", readySelector: "main#main", waitForAuthResolution: true },
  {
    name: "today",
    path: "/today",
    readySelector: '[data-testid="today-screen"]',
    waitForAuthResolution: true,
  },
  {
    name: "tonight",
    path: "/tonight",
    readySelector:
      '[data-testid="tonight-screen"][data-listings-status="ready"]:has(.tonightFootLink), [data-testid="tonight-screen"][data-listings-status="empty"]:has(.tonightStatusLink), [data-testid="tonight-screen"][data-listings-status="error"]:has(.tonightStatusError .tonightRetry), [data-testid="tonight-screen"]:not([data-listings-status]):has(.tonightFootLink, .tonightStatusLink, .tonightStatusError .tonightRetry)',
    pendingSelectors: ["[data-testid='listings-skeleton']"],
    waitForAuthResolution: true,
  },
  { name: "near", path: "/near", readySelector: ".nmnIntro", waitForAuthResolution: true },
  {
    name: "add",
    path: "/add/karan",
    readySelector: "main.addShell",
    waitForAuthResolution: true,
  },
  {
    name: "login",
    path: "/login",
    readySelector:
      ".loginPageForm, .loginPageSignedIn, .loginPageWelcomeBack, .loginPageNotice",
  },
  {
    name: "profile",
    path: "/u/karan",
    readySelector: "main.profileMain",
    pendingSelectors: [".profileTimelineSkel", ".profileHeaderLoading"],
    waitForAuthResolution: true,
  },
  {
    name: "map",
    path: "/map/london",
    readySelector: ".mapCanvasWrap:has(.maplibreMap)",
    pendingSelectors: ["main.mapSkeleton", ".mapLoading"],
    waitForPaintedMap: true,
    settlementTimeoutMs: 60_000,
  },
  {
    name: "plan",
    path: "/plan",
    readySelector: "main.planPage h1",
    waitForAuthResolution: true,
  },
  {
    name: "crawls",
    path: "/crawls",
    readySelector:
      "main.crawlsShell:not([aria-busy='true']):is([data-venue-index-status='ready'], :not([data-venue-index-status]):has(.curatedPriceFrom))",
    waitForAuthResolution: true,
  },
];

export const AUDITED_FLOWS = [
  {
    name: "login-sheet-open",
    route: "home",
    dependencies: ["home"],
    desktopOnly: true,
    allowedNotApplicableResults: [{
      reason: "sign-in-trigger-unavailable",
      authConfigured: false,
    }],
  },
  { name: "tonight-browse", route: "tonight", dependencies: ["tonight", "map"] },
  { name: "near-answer", route: "near", dependencies: ["near"] },
  { name: "add-form-open", route: "add", dependencies: ["add"] },
  { name: "map-pan-zoom", route: "map", dependencies: ["map"], desktopOnly: true },
];

function selectAuditValues(filter, values, environmentName, noun, matches) {
  if (filter === undefined) return values;

  const requested = filter.split(",").map((value) => value.trim()).filter(Boolean);
  if (requested.length === 0) {
    throw new Error(`${environmentName} must select at least one ${noun}`);
  }

  const unknown = requested.filter((value) => !values.some((candidate) => matches(candidate, value)));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${environmentName} value: ${unknown.join(", ")}`);
  }

  const selected = values.filter((candidate) => requested.some((value) => matches(candidate, value)));
  if (selected.length === 0) {
    throw new Error(`${environmentName} must select at least one ${noun}`);
  }
  return selected;
}

export function selectAuditedOrigins(filter) {
  return selectAuditValues(filter, AUDITED_ORIGINS, "UI_UX_ORIGINS", "origin", (origin, value) =>
    origin.name === value,
  );
}

export function selectAuditedRoutes(filter) {
  return selectAuditValues(filter, AUDITED_ROUTES, "UI_UX_ROUTES", "route", (route, value) =>
    route.name === value || route.path === value,
  );
}

export function selectAuditedFlows(routes) {
  const routeNames = new Set(AUDITED_ROUTES.map(({ name }) => name));
  for (const flow of AUDITED_FLOWS) {
    for (const dependency of flow.dependencies) {
      if (!routeNames.has(dependency)) {
        throw new Error(`Unknown route dependency for ${flow.name}: ${dependency}`);
      }
    }
  }
  const selectedNames = new Set(routes.map(({ name }) => name));
  return AUDITED_FLOWS.filter(({ dependencies }) =>
    dependencies.every((dependency) => selectedNames.has(dependency)),
  );
}

export function configureAuditedFlowsForRunMode(flows, { frozenLiveBaseline = false } = {}) {
  if (!frozenLiveBaseline) return flows;
  return flows.map((flow) => flow.name === "login-sheet-open" ? {
    ...flow,
    allowedNotApplicableResults: [
      ...(flow.allowedNotApplicableResults ?? []),
      {
        reason: "frozen-live-autofocus-unavailable",
        origin: "live",
        frozenLiveBaseline: true,
      },
    ],
  } : flow);
}

export async function waitForAuditedRouteSettlement(page, route, timeout) {
  const settlementTimeout = timeout ?? route.settlementTimeoutMs ?? 30_000;
  await page.bringToFront();
  await page.locator(route.readySelector).first().waitFor({
    state: "visible",
    timeout: settlementTimeout,
  });
  for (const selector of route.pendingSelectors ?? []) {
    await page.locator(selector).waitFor({ state: "hidden", timeout: settlementTimeout });
  }
  for (const text of route.pendingTexts ?? []) {
    await page.getByText(text).waitFor({ state: "hidden", timeout: settlementTimeout });
  }
  if (route.waitForAuthResolution) {
    await page
      .locator('[data-auth-resolved="true"], .authUser')
      .first()
      .waitFor({ state: "attached", timeout: settlementTimeout });
  }
  if (route.waitForPaintedMap) {
    const localAudit = isLocalUiUxAuditOrigin(page.url());
    if (!localAudit) {
      const reducedMotion = await page.evaluate(() =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      if (!reducedMotion) {
        throw new Error("Frozen live map audit requires reduced motion");
      }
    }
    await page.waitForFunction((requireEntranceSettlement) => {
      if (document.querySelector(".mapFallback")) return false;
      const pinTrace = performance.getEntriesByName("pubmax:first-pins").length > 0;
      const entranceSettled =
        performance.getEntriesByName("pubmax:pin-entrance-settled").length > 0;
      const tapPoints = window.__pubmaxPaintedMapTapPoints;
      return pinTrace &&
        (!requireEntranceSettlement || entranceSettled) &&
        typeof tapPoints === "function" &&
        tapPoints().length > 0;
    }, localAudit, { timeout: settlementTimeout });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    const settlingAnimations = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getTiming();
      const duration = Number(timing?.duration);
      const delay = Number(timing?.delay);
      const iterations = Number(timing?.iterations);
      const totalDuration = (duration + delay) * iterations;
      return animation.playState === "running" && Number.isFinite(totalDuration) && totalDuration <= 2_000;
    });
    await Promise.allSettled(settlingAnimations.map((animation) => animation.finished));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  return page.evaluate((budget) => {
    const metrics = window.__pubmaxUiUxAuditMetrics;
    return {
      cls: metrics?.supported ? metrics.cls : null,
      clsSupported: metrics?.supported ?? false,
      clsBudget: budget,
    };
  }, UI_UX_CLS_BUDGET);
}

export async function navigateToAuditedRoute(page, originUrl, route, timeout) {
  const navigationTimeout = timeout ?? 30_000;
  await page.addInitScript(() => {
    if (window.__pubmaxUiUxAuditMetrics) return;
    const supported = PerformanceObserver.supportedEntryTypes.includes("layout-shift");
    window.__pubmaxUiUxAuditMetrics = {
      cls: 0,
      supported,
      sessionValue: 0,
      sessionStart: 0,
      lastShift: 0,
    };
    if (!supported) return;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        const metrics = window.__pubmaxUiUxAuditMetrics;
        const withinSession =
          metrics.sessionValue > 0 &&
          entry.startTime - metrics.lastShift < 1_000 &&
          entry.startTime - metrics.sessionStart < 5_000;
        metrics.sessionValue = withinSession
          ? metrics.sessionValue + (entry.value ?? 0)
          : entry.value ?? 0;
        metrics.sessionStart = withinSession ? metrics.sessionStart : entry.startTime;
        metrics.lastShift = entry.startTime;
        metrics.cls = Math.max(metrics.cls, metrics.sessionValue);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  const url = new URL(route.path, originUrl).href;
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = page.url() === url
        ? await page.reload({ waitUntil: "domcontentloaded", timeout: navigationTimeout })
        : await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
      break;
    } catch (error) {
      if (attempt > 0 || !String(error?.message).includes("net::ERR_ABORTED")) throw error;
      await page.waitForTimeout(100);
    }
  }
  if (!response) {
    throw new Error(`Navigation produced no HTTP response for ${url}`);
  }
  if (!response.ok()) {
    throw new Error(`Navigation returned HTTP ${response.status()} for ${url}`);
  }
  return waitForAuditedRouteSettlement(page, route, timeout);
}
