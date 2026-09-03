import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  AUDITED_ORIGINS,
  AUDITED_ROUTES,
  UI_UX_CLS_BUDGET,
  navigateToAuditedRoute,
  selectAuditedFlows,
  selectAuditedOrigins,
  selectAuditedRoutes,
  waitForAuditedRouteSettlement,
} from "../scripts/lib/uiUxBattleTestNavigation.mjs";
import {
  UI_UX_CHROMIUM_ARGS,
  UI_UX_MOTION_POLICY,
  UI_UX_PAGE_SCREENSHOT_OPTIONS,
  assertUiUxCurrentFocus,
  assertUiUxVisibleFocusIndicator,
  hasResolvedUnconfiguredAuth,
  uiUxAuditContextOptions,
  uiUxChromiumLaunchOptions,
} from "../scripts/lib/uiUxBattleTestBrowser.mjs";
import { resolveAuditOutputRoot } from "../scripts/lib/uiUxBattleTestOutput.mjs";

test("audit output stays inside dedicated temporary root", () => {
  expect(resolveAuditOutputRoot("after-dark")).toBe(
    "/tmp/pubmax-ui-ux-battle-test/after-dark",
  );
  for (const unsafe of [".", "..", "../proof", "/tmp/proof"]) {
    expect(() => resolveAuditOutputRoot(unsafe)).toThrow(
      "UI_UX_OUTPUT must be one safe directory name",
    );
  }
});

test("audit filters reject empty and unknown selections", () => {
  expect(selectAuditedOrigins("local")).toEqual([AUDITED_ORIGINS[1]]);
  expect(selectAuditedRoutes("today,/crawls")).toEqual([
    AUDITED_ROUTES[1],
    AUDITED_ROUTES[AUDITED_ROUTES.length - 1],
  ]);
  expect(() => selectAuditedOrigins("")).toThrow("select at least one origin");
  expect(() => selectAuditedOrigins("staging")).toThrow("Unknown UI_UX_ORIGINS value: staging");
  expect(() => selectAuditedRoutes("/missing")).toThrow("Unknown UI_UX_ROUTES value: /missing");
});

test("route filters constrain named flows to complete dependencies", () => {
  expect(selectAuditedFlows([AUDITED_ROUTES[6]]).map(({ name }) => name)).toEqual([]);
  expect(selectAuditedFlows([AUDITED_ROUTES[2], AUDITED_ROUTES[7]]).map(({ name }) => name))
    .toEqual(["tonight-browse", "map-pan-zoom"]);
});

test("audit browser policy supplies SwiftShader to every caller", () => {
  expect(UI_UX_CHROMIUM_ARGS).toContain("--use-angle=swiftshader");
  expect(UI_UX_CHROMIUM_ARGS).toContain("--enable-unsafe-swiftshader");
  expect(uiUxChromiumLaunchOptions()).toEqual({
    headless: true,
    args: UI_UX_CHROMIUM_ARGS,
  });
  expect(uiUxChromiumLaunchOptions("chrome")).toEqual({
    headless: true,
    channel: "chrome",
    args: UI_UX_CHROMIUM_ARGS,
  });
  expect(uiUxAuditContextOptions("http://localhost:3000")).toEqual({});
  expect(uiUxAuditContextOptions("https://pubmaxxing.com")).toEqual({
    reducedMotion: "reduce",
  });
  expect(UI_UX_MOTION_POLICY).toEqual({ live: "reduce", local: "no-preference" });
  expect(UI_UX_PAGE_SCREENSHOT_OPTIONS).toEqual({ fullPage: false });
});

test("audit checks existing product focus without moving it", async ({ page }) => {
  await page.setContent(`
    <style>:focus-visible { outline: 3px solid rgb(0, 0, 0); }</style>
    <button id="trigger">Trigger</button>
    <input id="first" />
  `);
  const trigger = page.locator("#trigger");
  const first = page.locator("#first");
  await trigger.focus();

  await expect(assertUiUxCurrentFocus(first, "First control")).rejects.toThrow(
    "did not receive product autofocus",
  );
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Tab");
  await assertUiUxCurrentFocus(first, "First control");
  await assertUiUxVisibleFocusIndicator(first, "First control");
});

test("audit skips unavailable sign in only for resolved keyless auth", async ({ page }) => {
  await page.setContent(
    '<span hidden data-auth-resolved="true" data-auth-configured="true"></span>',
  );
  expect(await hasResolvedUnconfiguredAuth(page)).toBe(false);

  await page.setContent(
    '<span hidden data-auth-resolved="true" data-auth-configured="false"></span>',
  );
  expect(await hasResolvedUnconfiguredAuth(page)).toBe(true);
});

test("shared audit navigation rejects HTTP failures and waits for settled UI", async ({
  baseURL,
  page,
}) => {
  await page.route("**/audit-http-failure", (route) =>
    route.fulfill({ status: 503, contentType: "text/html", body: "<main>Unavailable</main>" }),
  );
  await expect(
    navigateToAuditedRoute(page, baseURL!, {
      name: "failure",
      path: "/audit-http-failure",
      readySelector: "main",
    }),
  ).rejects.toThrow("HTTP 503");

  await page.unroute("**/audit-http-failure");
  await page.route("**/audit-delayed", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <main class="pending">Loading</main>
        <script>
          setTimeout(() => {
            document.querySelector(".pending").remove();
            document.body.insertAdjacentHTML("beforeend", '<main class="ready">Ready</main>');
          }, 100);
        </script>
      `,
    }),
  );
  await navigateToAuditedRoute(page, baseURL!, {
    name: "delayed",
    path: "/audit-delayed",
    readySelector: ".ready",
    pendingSelectors: [".pending"],
  });
  await expect(page.locator(".ready")).toBeVisible();
  await expect(page.locator(".pending")).toHaveCount(0);
});

test("shared audit navigation requires a painted map trace", async ({ baseURL, page }) => {
  expect(AUDITED_ROUTES.find(({ name }) => name === "map")).toMatchObject({
    settlementTimeoutMs: 60_000,
  });

  await page.route("**/audit-map", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <main class="mapCanvasWrap">
          <div class="mapFallback">Fallback</div>
        </main>
        <script>
          window.__pubmaxPaintedMapTapPoints = () => [];
        </script>
      `,
    }),
  );

  await expect(
    navigateToAuditedRoute(page, baseURL!, {
      name: "map-fallback",
      path: "/audit-map",
      readySelector: ".mapCanvasWrap",
      waitForPaintedMap: true,
    }, 300),
  ).rejects.toThrow();

  await page.unroute("**/audit-map");
  await page.route("**/audit-map", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <main class="mapCanvasWrap"><canvas class="maplibreMap"></canvas></main>
        <script>
          window.__pubmaxPaintedMapTapPoints = () => [];
          setTimeout(() => {
            performance.mark("pubmax:first-pins");
            window.__pubmaxPaintedMapTapPoints = () => [
              { kind: "pin", id: "venue-1", x: 40, y: 40 }
            ];
          }, 100);
          setTimeout(() => performance.mark("pubmax:pin-entrance-settled"), 250);
        </script>
      `,
    }),
  );

  await navigateToAuditedRoute(page, baseURL!, {
    name: "map-painted",
    path: "/audit-map",
    readySelector: ".mapCanvasWrap",
    waitForPaintedMap: true,
  });
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  expect(await page.evaluate(() =>
    performance.getEntriesByName("pubmax:pin-entrance-settled").length,
  )).toBeGreaterThan(0);
});

test("shared readiness accepts frozen live markers", async ({ page }) => {
  await page.route("https://pubmaxxing.com/crawls", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <main class="crawlsShell">Crawls</main>
        <div class="authUser"></div>
        <script>
          setTimeout(() => {
            document.querySelector("main").insertAdjacentHTML(
              "beforeend",
              '<span class="curatedPriceFrom">Pints from £4.50</span>',
            );
          }, 100);
        </script>
      `,
    }),
  );

  await navigateToAuditedRoute(
    page,
    "https://pubmaxxing.com",
    AUDITED_ROUTES.find(({ name }) => name === "crawls")!,
    500,
  );
  expect(await page.locator(".curatedPriceFrom").count()).toBe(1);
  await expect(page.locator("main.crawlsShell")).toBeVisible();
});

test("frozen live map readiness requires reduced motion", async ({ page }) => {
  await page.route("https://pubmaxxing.com/map/london", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <main class="mapCanvasWrap"><canvas class="maplibreMap"></canvas></main>
        <script>
          performance.mark("pubmax:first-pins");
          window.__pubmaxPaintedMapTapPoints = () => [
            { kind: "pin", id: "venue-1", x: 40, y: 40 }
          ];
        </script>
      `,
    }),
  );
  const route = {
    name: "live-map",
    path: "/map/london",
    readySelector: ".mapCanvasWrap:has(.maplibreMap)",
    waitForPaintedMap: true,
  };

  await expect(
    navigateToAuditedRoute(page, "https://pubmaxxing.com", route, 300),
  ).rejects.toThrow("reduced motion");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await navigateToAuditedRoute(page, "https://pubmaxxing.com", route, 500);
});

test("Tonight reserves loading space without holding settled content", async ({
  baseURL,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/whats-on?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [], asOf: "2026-08-14T18:00:00.000Z" }),
    });
  });
  await page.route("**/api/out?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [],
      }),
    });
  });

  const route = AUDITED_ROUTES.find(({ name }) => name === "tonight")!;
  const navigation = navigateToAuditedRoute(page, baseURL!, route);
  await expect(page.getByTestId("listings-skeleton")).toBeVisible();
  expect(await page.locator(".tonightPrimary").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).minHeight),
  )).toBeGreaterThan(0);
  await expect(page.locator(".tonightAfterPrimary")).toHaveCSS("visibility", "hidden");

  const result = await navigation;
  await expect(page.locator(".tonightPrimary")).toHaveCSS("min-height", "0px");
  await expect(page.locator(".tonightAfterPrimary")).toHaveCSS("visibility", "visible");
  expect(result.cls).not.toBeNull();
  expect(result.cls!).toBeLessThan(UI_UX_CLS_BUDGET);
});

test("Tonight error settles without holding loading space", async ({ baseURL, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/whats-on?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [], error: "Store unavailable" }),
    });
  });
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [],
      }),
    }),
  );

  const route = AUDITED_ROUTES.find(({ name }) => name === "tonight")!;
  const result = await navigateToAuditedRoute(page, baseURL!, {
    ...route,
    readySelector:
      '[data-testid="tonight-screen"][data-listings-status="error"]:has(.tonightStatusError .tonightRetry)',
  });
  await waitForAuditedRouteSettlement(page, route, 500);
  await expect(page.locator(".tonightStatusError")).toBeVisible();
  await expect(page.locator(".tonightPrimary")).toHaveCSS("min-height", "0px");
  await expect(page.locator(".tonightAfterPrimary")).toHaveCSS("visibility", "visible");
  expect(result.cls).not.toBeNull();
  expect(result.cls!).toBeLessThan(UI_UX_CLS_BUDGET);
});

test("shared audit navigation measures layout shift from navigation start", async ({
  baseURL,
  page,
}) => {
  await page.route("**/audit-cls", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <style>body { margin: 0; } main { height: 700px; background: #eee; }</style>
        <main>Settling</main>
        <script>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
            const banner = document.createElement("div");
            banner.style.height = "180px";
            document.body.prepend(banner);
            document.body.dataset.settled = "true";
          }, 50)));
        </script>
      `,
    }),
  );

  const result = await navigateToAuditedRoute(page, baseURL!, {
    name: "layout-shift",
    path: "/audit-cls",
    readySelector: 'body[data-settled="true"]',
  });
  expect(result.cls).toBeGreaterThan(0);
});

test("keyless readiness waits for client hydration", async ({ baseURL, page }) => {
  const near = AUDITED_ROUTES.find((route) => route.name === "near")!;
  await navigateToAuditedRoute(page, baseURL!, near);
  await page.getByRole("button", { name: "Soho", exact: true }).click();
  await expect(page.locator(".nmnHead")).toBeVisible();
});

test("audited labels keep readable contrast in reachable states", async ({ baseURL, page }) => {
  test.setTimeout(120_000);
  for (const theme of ["light", "dark"]) {
    await page.goto("/");
    await page.evaluate((value) => localStorage.setItem("pubmax-theme", value), theme);

    await navigateToAuditedRoute(page, baseURL!, AUDITED_ROUTES[0]);
    const landing = await new AxeBuilder({ page })
      .include(".lpProofSection .lpSectionLabel")
      .withRules(["color-contrast"])
      .analyze();
    expect(landing.violations, `${theme} landing contrast`).toEqual([]);

    const tonightRoute = AUDITED_ROUTES.find((route) => route.name === "tonight")!;
    await navigateToAuditedRoute(page, baseURL!, tonightRoute);
    await page.locator(".tonightFootLink").hover();
    const tonight = await new AxeBuilder({ page })
      .include(".tonightFootLink")
      .withRules(["color-contrast"])
      .analyze();
    expect(tonight.violations, `${theme} Tonight contrast`).toEqual([]);

    const crawlsRoute = {
      ...AUDITED_ROUTES.find((route) => route.name === "crawls")!,
      path: "/crawls?pack=old-london",
    };
    await navigateToAuditedRoute(page, baseURL!, crawlsRoute);
    await expect(page.locator('[data-venue-index-status="ready"]')).toBeVisible();
    await page.locator(".routePackChip.isActive").hover();
    const crawls = await new AxeBuilder({ page })
      .include(".routePackChip.isActive")
      .include(".routePackActiveNote a")
      .include(".curatedPriceFrom")
      .withRules(["color-contrast"])
      .analyze();
    expect(crawls.violations, `${theme} Crawls contrast`).toEqual([]);
  }
});

test.describe("UI UX battle-test guardrails", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("first-visit consent link meets the touch target floor", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("pubmaxx:analytics-consent:v1");
    });
    await page.goto("/today");
    const privacy = page.locator(".analyticsConsentPrompt a");
    await expect(privacy).toBeVisible();
    const box = await privacy.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test("audited mobile routes keep tap targets and page width within contract", async ({
    baseURL,
    page,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    for (const route of AUDITED_ROUTES) {
      await navigateToAuditedRoute(page, baseURL!, route);

      const result = await page.evaluate(() => {
        const visible = (element: Element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.pointerEvents !== "none" &&
            Number.parseFloat(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const undersized = [...document.querySelectorAll(
          'button, a, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])',
        )]
          .filter(visible)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              element: element.tagName.toLowerCase(),
              label: (element.getAttribute("aria-label") || element.textContent || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80),
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
            };
          })
          .filter(({ width, height }) => width < 44 || height < 44);

        return {
          undersized,
          overflow: Math.max(
            document.documentElement.scrollWidth,
            document.body?.scrollWidth ?? 0,
          ) - document.documentElement.clientWidth,
        };
      });

      expect(result.undersized, `${route.path} has undersized interactive controls`).toEqual([]);
      expect(result.overflow, `${route.path} has horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });
});
