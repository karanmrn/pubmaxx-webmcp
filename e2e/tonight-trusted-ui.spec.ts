import fs from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page, type Request } from "@playwright/test";

// Tonight grouping remains rollout-controlled. Explicit Venue acceptance is a
// permanent action and is proved in this default project.

const SHOTS_DIR = path.join(process.cwd(), "e2e-shots", "tonight-trusted-ui");

// Deterministic spine: a two-venue deal family (collapses to one card), plus a
// music and a quiz row — enough to show grouping, the secondary lanes, and an
// acceptable Venue, without depending on live upstream data.
const TEST_TONIGHT_START = Date.now() + 60 * 60 * 1000;
const ROWS = [
  { id: "d1", venueId: "venue-deala", placeName: "The Deal Arms A", kind: "deal", startsAt: new Date(TEST_TONIGHT_START).toISOString(), title: "Curry Club", source: { label: "Chain Co", url: "https://chain.example/deal" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "d2", venueId: "venue-dealb", placeName: "The Deal Arms B", kind: "deal", startsAt: new Date(TEST_TONIGHT_START).toISOString(), title: "Curry Club", source: { label: "Chain Co", url: "https://chain.example/deal" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "m1", venueId: "venue-music", placeName: "The Blue Note", kind: "music", startsAt: new Date(TEST_TONIGHT_START + 60 * 60 * 1000).toISOString(), title: "Live Jazz", source: { label: "Listings", url: "https://listings.example/jazz" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "q1", venueId: "venue-quiz", placeName: "The Sharp Wit", kind: "quiz", startsAt: new Date(TEST_TONIGHT_START - 30 * 60 * 1000).toISOString(), title: "Pub Quiz", source: { label: "Listings", url: "https://listings.example/quiz" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
];

type WhatsOnBody = { sourceFreshnessKind?: string; sourceObservedAt?: string | null };

async function mockWhatsOn(page: Page, body: WhatsOnBody = {}) {
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
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: ROWS,
        servedAt: "2026-07-24T22:00:00.000Z",
        sourceObservedAt: body.sourceObservedAt ?? "2026-07-20T12:00:00.000Z",
        sourceFreshnessKind: body.sourceFreshnessKind ?? "provider-observed",
        localityBasis: "london-default",
        asOf: body.sourceObservedAt ?? "2026-07-20T12:00:00.000Z",
      }),
    }),
  );
}

function trackWhatsOn(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req: Request) => {
    if (req.url().includes("/api/whats-on")) urls.push(req.url());
  });
  return urls;
}

async function openTonight(page: Page, viewport = { width: 390, height: 844 }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => window.localStorage.setItem("pubmax-tour-v1-done", "1"));
  const response = await page.goto("/tonight");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("tonight-list")).toBeVisible();
}

// A Tonight row settles in with a scaled entrance (tonight.css `tonightRowIn`),
// so a rendered box measured while it runs is the row's animated box, not the
// laid-out one. The 48px touch target is a claim about the settled control, so
// let the row's animations finish before measuring anything inside it.
async function settleRowEntrance(target: Locator): Promise<void> {
  await target.evaluate(async (node) => {
    const row = node.closest(".tonightRow") ?? node;
    await Promise.all(
      row.getAnimations({ subtree: true }).map((animation) =>
        animation.finished.catch(() => undefined),
      ),
    );
  });
}

async function captureAnalytics(page: Page): Promise<unknown[]> {
  const payloads: unknown[] = [];
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) payloads.push(JSON.parse(raw));
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  return payloads;
}

async function shoot(page: Page, name: string) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    // The app's dark theme is driven by html[data-theme="dark"], NOT the OS media
    // query, so set the attribute directly — emulateMedia alone leaves it light.
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((s) => document.documentElement.setAttribute("data-theme", s), scheme);
    for (const width of [390, 1440] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.screenshot({ path: path.join(SHOTS_DIR, `${name}-${width}-${scheme}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe("Tonight trusted UI (flag off / shipped)", () => {
  test("keeps a Venue for tonight only after the explicit action", async ({ page }) => {
    await mockWhatsOn(page);
    await openTonight(page);

    expect(await page.evaluate(() => sessionStorage.getItem("pubmax:planning-intent:v1"))).toBeNull();
    const accept = page.getByRole("button", { name: "Keep The Deal Arms A for tonight" });
    const row = page.locator(".tonightRow", { has: accept });
    await row.getByRole("link").click();
    await expect(page).toHaveURL(/\/map\?[^#]*sel=venue-deala/);
    expect(new URL(page.url()).searchParams.get("accept")).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem("pubmax:planning-intent:v1"))).toBeNull();

    await page.goBack();
    await expect(page.getByTestId("tonight-list")).toBeVisible();
    await expect(accept).toBeVisible();
    await settleRowEntrance(accept);
    const box = await accept.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
    const appearance = await accept.evaluate((button) => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:fixed;background:var(--state-active-surface);border:1px solid var(--state-active-border);color:var(--state-active-ink)";
      document.body.appendChild(probe);
      const actual = getComputedStyle(button);
      const expected = getComputedStyle(probe);
      const result = {
        actual: [actual.backgroundColor, actual.borderColor, actual.color],
        expected: [expected.backgroundColor, expected.borderColor, expected.color],
      };
      probe.remove();
      return result;
    });
    expect(appearance.actual).toEqual(appearance.expected);
    await accept.click();
    await expect(page).toHaveURL(/\/map\?[^#]*accept=1[^#]*src=tonight/);
    const stored = await page.evaluate(() => {
      const raw = sessionStorage.getItem("pubmax:planning-intent:v1");
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored?.source).toBe("tonight");
    expect(stored?.acceptedVenueId).toBe("venue-deala");
  });

  test("storage denial stays on Tonight and emits no acceptance events", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
      const nativeSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (this === sessionStorage && key === "pubmax:planning-intent:v1") {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        }
        return nativeSetItem.call(this, key, value);
      };
    });
    const payloads = await captureAnalytics(page);
    await mockWhatsOn(page);
    await openTonight(page);

    await page.getByRole("button", { name: "Keep The Deal Arms A for tonight" }).click();

    await expect(page).toHaveURL(/\/tonight$/);
    await expect(page.locator(".tonightAcceptanceError")).toHaveText(
      "Couldn’t keep this pub on this device. Try again.",
    );
    // Visible error is action completion. Storage failed before trackEvent, so
    // no analytics request can be queued after this state.
    expect(payloads.some((payload) => (
      payload && typeof payload === "object"
      && ["venue_accepted", "planning_handoff_opened"].includes(
        String((payload as { name?: unknown }).name),
      )
    ))).toBe(false);
  });

  test("keeps the main list before Deals/Music and above the mobile tab bar", async ({ page }) => {
    await mockWhatsOn(page);
    await openTonight(page);
    // Every user gets the primary confirmed listings first, including the
    // default flag-off installed-app cold-start path.
    const deals = page.locator(".dealsTonight").first();
    await expect(deals).toBeVisible();
    const order = await page.evaluate(() => {
      const d = document.querySelector(".dealsTonight");
      const l = document.querySelector('[data-testid="tonight-list"]');
      return d && l ? l.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order).toBeTruthy(); // list FOLLOWS deals → list above

    const firstRow = await page.locator(".tonightRow").first().boundingBox();
    const mobileTabBar = await page.locator(".mobileTabBar").boundingBox();
    expect(firstRow).not.toBeNull();
    expect(mobileTabBar).not.toBeNull();
    expect(firstRow!.y).toBeLessThan(mobileTabBar!.y);
    await shoot(page, "flagoff");
  });

  test("loads the spine once — secondary lanes reuse, never self-fetch", async ({ page }) => {
    const urls = trackWhatsOn(page);
    await mockWhatsOn(page);
    await openTonight(page);
    await expect(page.getByTestId("tonight-list")).toBeVisible();
    await page.waitForTimeout(500);
    // The main list fetches window=tonight; the lanes must NOT self-fetch by kind.
    expect(urls.filter((u) => /kind=deal|kind=music/.test(u))).toHaveLength(0);
    expect(urls.filter((u) => u.includes("window=tonight")).length).toBe(1);
  });

  test("renders honest unknown freshness, never request time", async ({ page }) => {
    await mockWhatsOn(page, { sourceFreshnessKind: "unknown", sourceObservedAt: null });
    await openTonight(page);
    // An undatable source leaves the interpunct chain and states the fact in
    // its own sentence, so the header stops reading like debug output. Anchored
    // on the line's own data attribute, not on that sentence.
    await expect(page.locator('[data-tonight-provenance="whats-on"]')).toHaveAttribute("data-tonight-dated", "no");
    await expect(page.locator('[data-tonight-provenance="undated-whats-on"]')).toBeVisible();
    await expect(page.getByText(/Checked 24 Jul/i)).toHaveCount(0);
  });
});

test.describe("Discover secondary lanes still self-fetch", () => {
  test("the deals lane fetches its own spine on /discover (no host to reuse)", async ({ page }) => {
    const urls = trackWhatsOn(page);
    await mockWhatsOn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => window.localStorage.setItem("pubmax-tour-v1-done", "1"));
    const response = await page.goto("/discover");
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(800);
    // On Discover the lanes have no host rows, so they self-fetch by kind.
    expect(urls.some((u) => u.includes("kind=deal"))).toBe(true);
  });
});
