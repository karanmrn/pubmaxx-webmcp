import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_PHASE = process.env.UI_EVIDENCE_PHASE ?? "verify";
const CAPTURE_EVIDENCE =
  EVIDENCE_PHASE === "before" || EVIDENCE_PHASE === "after";
const ASSERT_LAYOUT = EVIDENCE_PHASE !== "before";
const ROUTES_ONLY = process.env.UI_EVIDENCE_ROUTES_ONLY === "1";
const SURFACES_ONLY = process.env.UI_EVIDENCE_SURFACES_ONLY === "1";
const ROUTE_FILTERS = (process.env.UI_EVIDENCE_ROUTE_FILTER ?? "")
  .split(",")
  .filter(Boolean);
const EVIDENCE_SERVER_MODE =
  process.env.UI_EVIDENCE_SERVER_MODE ?? "unspecified";
const EVIDENCE_BUILD_COMMIT =
  process.env.UI_EVIDENCE_BUILD_COMMIT ?? "unspecified";
const EVIDENCE_ROOT = path.join(
  "docs",
  "evidence",
  "ui-consistency",
  EVIDENCE_PHASE === "after" ? "after" : "before",
);
const VENUE_ID = "venue-xjf3n0";
const PROFILE_HANDLE = "layoutcaptain";
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000091";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

test.use({ storageState: { cookies: [], origins: [] } });

const ROUTES = [
  { source: "app/page.tsx", path: "/" },
  { source: "app/about/page.tsx", path: "/about" },
  { source: "app/activity/page.tsx", path: "/activity" },
  { source: "app/add/[handle]/page.tsx", path: `/add/${PROFILE_HANDLE}` },
  { source: "app/admin/page.tsx", path: "/admin" },
  { source: "app/bar-tab/[id]/page.tsx", path: `/bar-tab/${VENUE_ID}` },
  { source: "app/borough/[slug]/page.tsx", path: "/borough/enfield" },
  { source: "app/borough/page.tsx", path: "/borough" },
  { source: "app/choose-city/page.tsx", path: "/choose-city" },
  { source: "app/contributors/page.tsx", path: "/contributors" },
  { source: "app/crawls/[slug]/page.tsx", path: "/crawls/layout-audit-missing" },
  { source: "app/crawls/page.tsx", path: "/crawls" },
  { source: "app/discover/page.tsx", path: "/discover" },
  { source: "app/drinks/page.tsx", path: "/drinks" },
  { source: "app/feed/page.tsx", path: "/feed" },
  { source: "app/historic/[slug]/page.tsx", path: "/historic/prospect-of-whitby" },
  { source: "app/historic/page.tsx", path: "/historic" },
  { source: "app/landmark/[id]/page.tsx", path: `/landmark/${VENUE_ID}` },
  { source: "app/ledger/[id]/page.tsx", path: `/ledger/${VENUE_ID}` },
  { source: "app/map/[city]/page.tsx", path: "/map/london" },
  { source: "app/map/page.tsx", path: "/map" },
  { source: "app/messages/[id]/page.tsx", path: "/messages/layout-audit-missing" },
  { source: "app/messages/page.tsx", path: "/messages" },
  { source: "app/moment/page.tsx", path: "/moment" },
  { source: "app/near/page.tsx", path: "/near" },
  { source: "app/onboarding/page.tsx", path: "/onboarding" },
  { source: "app/p/[id]/page.tsx", path: "/p/layout-audit-missing" },
  { source: "app/pal/chat/page.tsx", path: "/pal/chat" },
  { source: "app/pal/page.tsx", path: "/pal" },
  { source: "app/pint-index/[month]/page.tsx", path: "/pint-index/2026-06" },
  { source: "app/pint-index/page.tsx", path: "/pint-index" },
  { source: "app/plan/[id]/page.tsx", path: "/plan/layout-audit-missing" },
  { source: "app/plan/[id]/recap/page.tsx", path: "/plan/layout-audit-missing/recap" },
  { source: "app/plan/page.tsx", path: "/plan" },
  { source: "app/privacy/page.tsx", path: "/privacy" },
  { source: "app/profile/page.tsx", path: "/profile" },
  { source: "app/pubs/page.tsx", path: "/pubs" },
  { source: "app/recap/[storyId]/page.tsx", path: "/recap/layout-audit-missing" },
  { source: "app/rounds/[code]/page.tsx", path: "/rounds/layout-audit-missing" },
  { source: "app/rounds/page.tsx", path: "/rounds" },
  { source: "app/terms/page.tsx", path: "/terms" },
  { source: "app/today/page.tsx", path: "/today" },
  { source: "app/tonight/page.tsx", path: "/tonight" },
  {
    source: "app/u/[handle]/lists/[listType]/page.tsx",
    path: `/u/${PROFILE_HANDLE}/lists/favourites`,
  },
  { source: "app/u/[handle]/page.tsx", path: `/u/${PROFILE_HANDLE}` },
  { source: "app/we-are-out/page.tsx", path: "/we-are-out" },
] as const;

type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

type ControlRect = Rect & {
  label: string;
};

type RowMeasurement = {
  name: string;
  selector: string;
  controls: ControlRect[];
  /**
   * What the members of this set owe each other. A ROW is controls sitting side
   * by side, so they share one height. A COLUMN of deliberately different
   * shapes (the map edge's TfL pill and its round Near me FAB) shares no
   * height by design, but every member still owes the 44px tap floor - and it
   * has to stay measured, because dropping a control from the proof is how a
   * control stops being proven at all.
   */
  rule?: "shared-height" | "tap-floor";
};

type PanelMeasurement = Rect & {
  name: string;
  selector: string;
};

type SurfaceAssertion = {
  name: string;
  passed: boolean;
  detail: string;
};

type SurfaceMeasurement = {
  viewport: { width: number; height: number };
  surface: string;
  path: string;
  firstVisitPrompt: {
    kind: string;
    accessibleName: string;
    className: string;
  } | null;
  rows: RowMeasurement[];
  panels: PanelMeasurement[];
  assertions: SurfaceAssertion[];
  screenshot: string;
};

type RouteMeasurement = {
  viewportWidth: number;
  source: string;
  requestedPath: string;
  renderedPath: string;
  status: number | null;
  mainSelector: string | null;
  main: Rect | null;
  leftOffset: number | null;
  rightOffset: number | null;
  offsetDelta: number | null;
  computedMaxWidth: string | null;
  computedMarginLeft: string | null;
  computedMarginRight: string | null;
  classification: "centred" | "full-bleed" | "affected" | "no-main";
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function rectFromBox(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Rect {
  return {
    left: round(box.x),
    right: round(box.x + box.width),
    top: round(box.y),
    bottom: round(box.y + box.height),
    width: round(box.width),
    height: round(box.height),
  };
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function preparePage(
  page: Page,
  options: { firstVisit?: boolean; signedIn?: boolean } = {},
): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.addInitScript(
    ({ firstVisit, signedIn, authStorageKey, userId }) => {
      localStorage.setItem("pubmax-theme", "dark");
      if (!firstVisit) {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      }
      if (!signedIn) return;
      localStorage.setItem(
        authStorageKey,
        JSON.stringify({
          access_token: "pubmaxx-layout-e2e-access-token",
          refresh_token: "pubmaxx-layout-e2e-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 86_400,
          expires_in: 86_400,
          token_type: "bearer",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "layout-captain@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-07-30T00:00:00.000Z",
          },
        }),
      );
    },
    {
      firstVisit: Boolean(options.firstVisit),
      signedIn: Boolean(options.signedIn),
      authStorageKey: E2E_AUTH_STORAGE_KEY,
      userId: E2E_AUTH_USER_ID,
    },
  );

  if (!options.signedIn) return;
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    const url = route.request().url();
    const body = url.includes("/auth/v1/settings")
      ? { external: {} }
      : {
          id: E2E_AUTH_USER_ID,
          aud: "authenticated",
          role: "authenticated",
          email: "layout-captain@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-07-30T00:00:00.000Z",
        };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: PROFILE_HANDLE }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: true, handle: PROFILE_HANDLE }),
    });
  });
  await page.route(`**/api/profiles/${PROFILE_HANDLE}*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          id: "profile-layout-captain",
          handle: PROFILE_HANDLE,
          displayName: "Layout Captain",
          homeCity: "London",
          bio: "Keeps the night aligned.",
          createdAt: "2026-07-30T00:00:00.000Z",
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
        counts: { followers: 12, following: 8 },
        viewerFollowing: false,
      }),
    });
  });
  await page.route("**/api/social-connections", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: [],
        providers: {
          x: { oauth: false, manual: false },
          instagram: { oauth: false, manual: false },
          tiktok: { oauth: false, manual: false },
        },
      }),
    });
  });
  await page.route("**/api/me/night-profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: null }),
    });
  });
  await page.route("**/api/referrals/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: null }),
    });
  });
}

async function controlRects(locator: Locator): Promise<ControlRect[]> {
  return locator.evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.replace(/\s+/g, " ").trim() ??
            "",
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          top: Math.round(rect.top * 100) / 100,
          bottom: Math.round(rect.bottom * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        };
      }),
  );
}

async function row(
  page: Page,
  name: string,
  selector: string,
  rule: RowMeasurement["rule"] = "shared-height",
): Promise<RowMeasurement> {
  return {
    name,
    selector,
    rule,
    controls: await controlRects(page.locator(selector)),
  };
}

async function panel(
  page: Page,
  name: string,
  selector: string,
): Promise<PanelMeasurement | null> {
  const locator = page.locator(selector).first();
  if (!(await locator.isVisible().catch(() => false))) return null;
  const box = await locator.boundingBox().catch(() => null);
  return box ? { name, selector, ...rectFromBox(box) } : null;
}

function assertMeasured(
  assertions: SurfaceAssertion[],
  surface: string,
  viewportWidth: number,
  name: string,
  passed: boolean,
  detail: string,
): void {
  assertions.push({ name, passed, detail });
  expect(passed, `${surface} ${viewportWidth}: ${name} (${detail})`).toBe(
    true,
  );
}

async function measureSurfaceAssertions(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  surface: string,
  rows: RowMeasurement[],
  panels: PanelMeasurement[],
): Promise<SurfaceAssertion[]> {
  const assertions: SurfaceAssertion[] = [];
  if (!ASSERT_LAYOUT) return assertions;

  for (const measuredRow of rows) {
    if (measuredRow.rule === "tap-floor") {
      const smallestSide = round(
        Math.min(
          ...measuredRow.controls.map((control) =>
            Math.min(control.width, control.height),
          ),
        ),
      );
      assertMeasured(
        assertions,
        surface,
        viewport.width,
        `${measuredRow.name} keeps the 44px tap floor`,
        smallestSide >= 43.9,
        `${measuredRow.controls
          .map((control) => `${control.label} ${control.width}x${control.height}`)
          .join("; ")}`,
      );
      continue;
    }
    if (measuredRow.controls.length < 2) continue;
    const heights = measuredRow.controls.map((control) => control.height);
    const spread = round(Math.max(...heights) - Math.min(...heights));
    assertMeasured(
      assertions,
      surface,
      viewport.width,
      `${measuredRow.name} shares one control height`,
      spread <= 0.1,
      `${heights.join(", ")}px; spread ${spread}px`,
    );
  }

  if (surface === "map-first-visit") {
    const names =
      viewport.width <= 640
        ? ["mobile map topbar", "Describe the outing"]
        : [
            "desktop map navigation",
            "Tonight Arc panel",
            "desktop map toolbar",
          ];
    const stack = names
      .map((name) => panels.find((candidate) => candidate.name === name))
      .filter((candidate): candidate is PanelMeasurement => Boolean(candidate));
    assertMeasured(
      assertions,
      surface,
      viewport.width,
      "floating map stack shares one horizontal boundary",
      stack.length === names.length &&
        Math.max(...stack.map((candidate) => candidate.left)) -
          Math.min(...stack.map((candidate) => candidate.left)) <=
          0.5 &&
        Math.max(...stack.map((candidate) => candidate.right)) -
          Math.min(...stack.map((candidate) => candidate.right)) <=
          0.5,
      stack
        .map(
          (candidate) =>
            `${candidate.name} ${candidate.left}-${candidate.right}px`,
        )
        .join("; "),
    );
  }

  if (surface === "map-first-visit" && viewport.width === 390) {
    const topbar = panels.find(
      (candidate) => candidate.name === "mobile map topbar",
    );
    const notice = panels.find(
      (candidate) => candidate.name === "analytics notice",
    );
    const planAction = panels.find(
      (candidate) => candidate.name === "Describe the outing",
    );
    const credit = panels.find(
      (candidate) => candidate.name === "map credit",
    );
    // The phone map chrome is ONE bar (design judgement 2026-08-01, finding
    // 2.3), so the whole stack is the bar's own height, not a three-row band.
    const chromeHeight = topbar ? round(topbar.bottom - topbar.top) : Number.NaN;
    assertMeasured(
      assertions,
      surface,
      viewport.width,
      "phone chrome stays within 164px",
      Number.isFinite(chromeHeight) && chromeHeight <= 164,
      `${chromeHeight}px`,
    );
    const barMetrics = await page
      .locator(".mobileMapTopbar")
      .evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    assertMeasured(
      assertions,
      surface,
      viewport.width,
      "phone controls stay in one uncut row",
      barMetrics.scrollWidth <= barMetrics.clientWidth,
      `scroll ${barMetrics.scrollWidth}px; client ${barMetrics.clientWidth}px; bar ${topbar?.left}-${topbar?.right}px`,
    );
    const overlap =
      notice && credit
        ? round(
            Math.max(
              0,
              Math.min(notice.bottom, credit.bottom) -
                Math.max(notice.top, credit.top),
            ),
          )
        : Number.NaN;
    assertMeasured(
      assertions,
      surface,
      viewport.width,
      "analytics notice leaves map credit reachable",
      Number.isFinite(overlap) && overlap === 0,
      `notice ${notice?.top}-${notice?.bottom}px; credit ${credit?.top}-${credit?.bottom}px; overlap ${overlap}px`,
    );
    const planOverlap =
      notice && planAction
        ? round(
            Math.max(
              0,
              Math.min(notice.bottom, planAction.bottom) -
                Math.max(notice.top, planAction.top),
            ),
          )
        : Number.NaN;
    assertMeasured(
      assertions,
      surface,
      viewport.width,
      "analytics notice leaves primary map action clear",
      Number.isFinite(planOverlap) && planOverlap === 0,
      `notice ${notice?.top}-${notice?.bottom}px; action ${planAction?.top}-${planAction?.bottom}px; overlap ${planOverlap}px`,
    );
    const noticeShare = notice
      ? round((notice.height / viewport.height) * 100)
      : Number.NaN;
    assertMeasured(
      assertions,
      surface,
      viewport.width,
      "analytics notice stays below 24 percent of phone height",
      Number.isFinite(noticeShare) && noticeShare < 24,
      `${noticeShare}%`,
    );
  }

  if (surface === "venue-sheet" && viewport.width === 390) {
    const captionChecks = await page
      .locator(".mobileVenuePeekSummary small:visible")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          return {
            text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            textOverflow: style.textOverflow,
          };
        }),
      );
    assertMeasured(
      assertions,
      surface,
      viewport.width,
      "venue captions stay uncut",
      captionChecks.length > 0 &&
        captionChecks.every(
          (caption) =>
            caption.scrollWidth <= caption.clientWidth + 1 &&
            caption.scrollHeight <= caption.clientHeight + 1 &&
            caption.textOverflow !== "ellipsis",
        ),
      JSON.stringify(captionChecks),
    );
  }
  return assertions;
}

async function verifyPostCaptureInteractions(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  surface: string,
  firstVisitPrompt: SurfaceMeasurement["firstVisitPrompt"],
  firstVisitPromptLocator: Locator,
  assertions: SurfaceAssertion[],
): Promise<void> {
  if (
    !ASSERT_LAYOUT ||
    surface !== "map-first-visit" ||
    viewport.width !== 390
  ) {
    return;
  }
  const creditButton = page.locator(".maplibregl-ctrl-attrib-button").first();
  await creditButton.click();
  assertMeasured(
    assertions,
    surface,
    viewport.width,
    "map credit expands",
    await page
      .locator(".maplibregl-ctrl-attrib-inner")
      .first()
      .isVisible(),
    "expanded attribution is visible",
  );
  if (firstVisitPrompt?.kind !== "analytics consent") return;
  await page.getByRole("button", { name: "No thanks" }).click();
  assertMeasured(
    assertions,
    surface,
    viewport.width,
    "analytics notice is dismissible",
    await firstVisitPromptLocator.isHidden(),
    "No thanks removes the notice",
  );
}

async function captureSurface(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  surface: string,
  pathname: string,
  readySelector: string,
  options: { firstVisit?: boolean; signedIn?: boolean } = {},
): Promise<SurfaceMeasurement> {
  await page.setViewportSize(viewport);
  await preparePage(page, options);
  const response = await page.goto(pathname, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${surface} ${pathname}`).toBe(200);
  await expect(page.locator(readySelector).first()).toBeVisible({
    timeout: 45_000,
  });
  if (surface === "map-first-visit" || surface === "venue-sheet") {
    await expect(
      page.locator(
        viewport.width <= 640 ? ".mobileMapChrome" : ".mapToolbar",
      ),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".mapLoading")).toBeHidden({
      timeout: 45_000,
    });
  }
  if (options.signedIn && ASSERT_LAYOUT) {
    await expect(page.locator("#account-settings")).toBeAttached({
      timeout: 45_000,
    });
  }
  if (options.firstVisit) {
    await page.waitForTimeout(1_000);
  }
  if (options.firstVisit && surface === "map-first-visit") {
    // Every berth this spec measures has a lifted variant under
    // `body:has(.mapArrivalCard)`, so the card MUST be gone before a single box
    // is read or the lifted state is recorded as the default. A best-effort
    // click cannot promise that: the card lands on pin reveal, which can be
    // later than any fixed wait, and a skipped click is silent.
    const arrivalCard = page.locator(".mapArrivalCard");
    await expect(arrivalCard).toBeVisible({ timeout: 45_000 });
    await arrivalCard.getByRole("button", { name: "Close" }).click();
    await expect(arrivalCard).toHaveCount(0, { timeout: 15_000 });
  }
  await settle(page);

  const firstVisitPromptLocator = page
    .locator('.analyticsConsentPrompt:visible, [role="dialog"]:visible')
    .first();
  const firstVisitPrompt =
    options.firstVisit &&
    (await firstVisitPromptLocator.isVisible().catch(() => false))
      ? await firstVisitPromptLocator.evaluate((element) => {
          const labelledBy = element.getAttribute("aria-labelledby");
          const labelledText = labelledBy
            ? document.getElementById(labelledBy)?.textContent?.trim() ?? ""
            : "";
          const ariaLabel = element.getAttribute("aria-label") ?? "";
          const className =
            typeof element.className === "string" ? element.className : "";
          return {
            kind: element.classList.contains("analyticsConsentPrompt")
              ? "analytics consent"
              : element.classList.contains("identityNudge")
                ? "identity nudge"
                : element.classList.contains("nativePushPrompt__card")
                  ? "push prompt"
                  : element.classList.contains("a2hsPrompt")
                    ? "install prompt"
                    : "dialog",
            accessibleName: ariaLabel || labelledText,
            className,
          };
        })
      : null;

  const rows = [
    await row(page, "mobile map topbar", ".mobileMapTopbar > a, .mobileMapTopbar > button"),
    await row(
      page,
      "map edge controls",
      ".mobileMapUtilityCorner > button",
      "tap-floor",
    ),
    await row(page, "Tonight Arc controls", ".tonightArcRow > button"),
    await row(
      page,
      "analytics decisions",
      ".analyticsConsentPromptActions > button",
    ),
    await row(
      page,
      "desktop map toolbar",
      [
        ".mapSearchSuggest--toolbar > label",
        ".mapToolbarDesktopExtras .favoritePintControl",
        ".mapToolbar > .mapToolbarRow > .conditionsChip",
        ".mapToolbarLensBtn",
        ".mapToolbarDrinksBtn",
        ".zonePickerBtn",
        ".planBtn",
        ".citySwitcherTrigger",
      ].join(", "),
    ),
    await row(page, "landing hero actions", ".lpHeroActions .lpButton"),
    await row(page, "Plan stop count choices", ".planStopCount__choices > button"),
    await row(page, "profile header actions", ".profileActions > a, .profileActions > button"),
    await row(page, "profile owner utilities", ".profileOwnerUtilities .siteNavMoreBtn"),
  ].filter((measurement) => measurement.controls.length > 0);

  const panelCandidates = await Promise.all([
    panel(page, "mobile map chrome", ".mobileMapChrome"),
    panel(page, "mobile map topbar", ".mobileMapTopbar"),
    panel(page, "Tonight Arc panel", ".tonightArcChips"),
    panel(page, "Describe the outing", ".mobilePlanActivation"),
    panel(page, "analytics notice", ".analyticsConsentPrompt"),
    panel(page, "desktop map navigation", ".siteNavBarFloating"),
    panel(page, "desktop map toolbar", ".mapToolbar"),
    panel(page, "map credit", ".maplibregl-ctrl-bottom-right"),
    panel(page, "page main", "main"),
  ]);
  const panels = panelCandidates.filter(
    (measurement): measurement is PanelMeasurement => measurement !== null,
  );
  const assertions = await measureSurfaceAssertions(
    page,
    viewport,
    surface,
    rows,
    panels,
  );

  const screenshot = `${surface}-${viewport.width}.png`;
  if (CAPTURE_EVIDENCE) {
    await page.screenshot({
      path: path.join(EVIDENCE_ROOT, screenshot),
      fullPage: false,
    });
  }

  await verifyPostCaptureInteractions(
    page,
    viewport,
    surface,
    firstVisitPrompt,
    firstVisitPromptLocator,
    assertions,
  );

  return {
    viewport: { width: viewport.width, height: viewport.height },
    surface,
    path: page.url().replace(/^https?:\/\/[^/]+/, ""),
    firstVisitPrompt,
    rows,
    panels,
    assertions,
    screenshot,
  };
}

async function auditRoute(
  page: Page,
  viewportWidth: 1280 | 1440,
  route: (typeof ROUTES)[number],
): Promise<RouteMeasurement> {
  await page.setViewportSize({
    width: viewportWidth,
    height: viewportWidth === 1280 ? 800 : 900,
  });
  let response = await page.goto(route.path, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  }).catch(() => null);
  if (!response || new URL(page.url()).pathname === "/") {
    response = await page.goto(route.path, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    }).catch(() => null);
  }
  await page
    .locator("main.routeLoadingShell")
    .waitFor({ state: "hidden", timeout: 45_000 })
    .catch(() => undefined);
  await settle(page);
  const main = page.locator("main, .cityChooserInner").first();
  const box = (await main.isVisible().catch(() => false))
    ? await main.boundingBox().catch(() => null)
    : null;
  if (!box) {
    return {
      viewportWidth,
      source: route.source,
      requestedPath: route.path,
      renderedPath: new URL(page.url()).pathname,
      status: response?.status() ?? null,
      mainSelector: null,
      main: null,
      leftOffset: null,
      rightOffset: null,
      offsetDelta: null,
      computedMaxWidth: null,
      computedMarginLeft: null,
      computedMarginRight: null,
      classification: "no-main",
    };
  }
  const mainRect = rectFromBox(box);
  const styles = await main.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      selector: `${element.tagName.toLowerCase()}${[...element.classList]
        .map((name) => `.${name}`)
        .join("")}`,
      maxWidth: computed.maxWidth,
      marginLeft: computed.marginLeft,
      marginRight: computed.marginRight,
    };
  });
  const leftOffset = round(mainRect.left);
  const rightOffset = round(viewportWidth - mainRect.right);
  const offsetDelta = round(Math.abs(leftOffset - rightOffset));
  const fullBleed =
    Math.abs(mainRect.left) <= 2 &&
    Math.abs(mainRect.right - viewportWidth) <= 2;
  const classification = fullBleed
    ? "full-bleed"
    : offsetDelta <= 2
      ? "centred"
      : "affected";

  return {
    viewportWidth,
    source: route.source,
    requestedPath: route.path,
    renderedPath: new URL(page.url()).pathname,
    status: response?.status() ?? null,
    mainSelector: styles.selector,
    main: mainRect,
    leftOffset,
    rightOffset,
    offsetDelta,
    computedMaxWidth: styles.maxWidth,
    computedMarginLeft: styles.marginLeft,
    computedMarginRight: styles.marginRight,
    classification,
  };
}

async function openSignedInProfileOptions(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await preparePage(page, { signedIn: true });
  await page.goto(`/u/${PROFILE_HANDLE}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#account-settings")).toBeAttached({
    timeout: 45_000,
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pubmax_handle")))
    .toBe(PROFILE_HANDLE);
  const trigger = page.getByRole("button", { name: "Profile options" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Profile options" });
  await expect(menu).toBeVisible();
  return { context, menu, page, trigger };
}

test("profile Options expose working existing actions", async ({ browser }) => {
  test.setTimeout(120_000);
  const firstVisit = await openSignedInProfileOptions(browser);
  await expect(
    firstVisit.menu.locator(".siteNavMoreLabel"),
  ).toHaveText([
    "Edit profile",
    "Analytics choices",
    "About",
    "Privacy",
    "Terms",
    "Sign out",
  ]);
  await expect(firstVisit.menu).not.toContainText("Help");
  await expect(
    firstVisit.menu.getByRole("menuitem", { name: /^Edit profile/ }),
  ).toBeFocused();
  await firstVisit.context.close();

  async function exercise(
    label: string,
    verify: (page: Page) => Promise<void>,
  ) {
    const visit = await openSignedInProfileOptions(browser);
    await visit.menu
      .getByRole("menuitem", { name: new RegExp(`^${label}`) })
      .click();
    await verify(visit.page);
    await visit.context.close();
  }

  await exercise("Edit profile", async (page) => {
    await expect(
      page.getByRole("form", { name: "Edit your profile" }),
    ).toBeVisible();
  });
  await exercise("Analytics choices", async (page) => {
    await expect(page).toHaveURL(/#analytics-settings$/);
    await expect(page.locator("#analytics-settings")).toBeInViewport();
  });
  for (const destination of ["about", "privacy", "terms"]) {
    const label =
      destination.charAt(0).toUpperCase() + destination.slice(1);
    await exercise(label, async (page) => {
      await expect(page).toHaveURL(new RegExp(`/${destination}$`));
      await expect(page.locator("main").first()).toBeVisible();
    });
  }
  await exercise("Sign out", async (page) => {
    await expect
      .poll(() =>
        page.evaluate(
          (storageKey) => localStorage.getItem(storageKey),
          E2E_AUTH_STORAGE_KEY,
        ),
      )
      .toBeNull();
  });
});

test("capture UI consistency evidence", async ({ browser }) => {
  test.setTimeout(40 * 60_000);
  if (CAPTURE_EVIDENCE) {
    await mkdir(EVIDENCE_ROOT, { recursive: true });
  }
  const existingMeasurements =
    CAPTURE_EVIDENCE && (ROUTES_ONLY || SURFACES_ONLY)
    ? JSON.parse(
        await readFile(path.join(EVIDENCE_ROOT, "measurements.json"), "utf8"),
      ) as {
        surfaces?: SurfaceMeasurement[];
        routeAudit?: RouteMeasurement[];
      }
    : null;
  const surfaces: SurfaceMeasurement[] = ROUTES_ONLY
    ? existingMeasurements?.surfaces ?? []
    : [];

  for (const viewport of ROUTES_ONLY ? [] : VIEWPORTS) {
    for (const spec of [
      {
        surface: "landing",
        pathname: "/",
        readySelector: ".lpHero",
        firstVisit: false,
      },
      {
        surface: "map-first-visit",
        pathname: "/map",
        readySelector: ".mapCanvasWrap",
        firstVisit: true,
      },
      {
        surface: "venue-sheet",
        pathname: `/map?sel=${VENUE_ID}`,
        readySelector: ".venueInspector",
        firstVisit: false,
      },
      {
        surface: "plan",
        pathname: "/plan",
        readySelector: ".planDescribeFirst",
        firstVisit: false,
      },
    ]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      surfaces.push(
        await captureSurface(
          page,
          viewport,
          spec.surface,
          spec.pathname,
          spec.readySelector,
          { firstVisit: spec.firstVisit },
        ),
      );
      await context.close();
    }

    const profileContext = await browser.newContext();
    const profilePage = await profileContext.newPage();
    surfaces.push(
      await captureSurface(
        profilePage,
        viewport,
        "profile-signed-in",
        `/u/${PROFILE_HANDLE}`,
        ".profileMain",
        { signedIn: true },
      ),
    );
    await profileContext.close();
  }

  const selectedRoutes = ROUTE_FILTERS.length > 0
    ? ROUTES.filter((route) => ROUTE_FILTERS.includes(route.path))
    : ROUTES;
  const routeAudit: RouteMeasurement[] =
    SURFACES_ONLY
      ? existingMeasurements?.routeAudit ?? []
      : ROUTE_FILTERS.length > 0 && existingMeasurements?.routeAudit
      ? existingMeasurements.routeAudit.filter(
          (measurement) => !ROUTE_FILTERS.includes(measurement.requestedPath),
        )
      : [];
  for (const viewportWidth of SURFACES_ONLY ? [] : [1280, 1440] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await preparePage(page);
    for (const route of selectedRoutes) {
      routeAudit.push(await auditRoute(page, viewportWidth, route));
    }
    await context.close();
  }
  const routeOrder = new Map(
    ROUTES.map((route, index) => [route.path, index] as const),
  );
  routeAudit.sort(
    (left, right) =>
      left.viewportWidth - right.viewportWidth ||
      (routeOrder.get(left.requestedPath) ?? 0) -
        (routeOrder.get(right.requestedPath) ?? 0),
  );

  if (ASSERT_LAYOUT && !SURFACES_ONLY) {
    const affected = routeAudit.filter(
      (measurement) => measurement.classification === "affected",
    );
    expect(
      affected,
      `desktop routes with unbalanced gutters: ${affected
        .map(
          (measurement) =>
            `${measurement.viewportWidth} ${measurement.requestedPath} ${measurement.leftOffset}/${measurement.rightOffset}`,
        )
        .join(", ")}`,
    ).toEqual([]);
    const incomplete = routeAudit.filter(
      (measurement) =>
        measurement.status === null ||
        measurement.mainSelector === "main.routeLoadingShell" ||
        (measurement.classification === "no-main" &&
          measurement.status !== 404),
    );
    expect(
      incomplete,
      `desktop route measurements incomplete: ${incomplete
        .map(
          (measurement) =>
            `${measurement.viewportWidth} ${measurement.requestedPath} ${measurement.status ?? "no response"} ${measurement.mainSelector ?? "no main"}`,
        )
        .join(", ")}`,
    ).toEqual([]);
  }

  if (CAPTURE_EVIDENCE) {
    await writeFile(
      path.join(EVIDENCE_ROOT, "measurements.json"),
      `${JSON.stringify(
        {
          phase: EVIDENCE_PHASE,
          capturedAt: new Date().toISOString(),
          server: {
            mode: EVIDENCE_SERVER_MODE,
            buildCommit: EVIDENCE_BUILD_COMMIT,
          },
          viewports: VIEWPORTS,
          surfaces,
          routeAudit,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
});
