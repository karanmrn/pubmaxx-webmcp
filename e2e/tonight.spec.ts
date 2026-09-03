import { test, expect, type Page } from "@playwright/test";

// First-class /tonight screen E2E. WebGL-agnostic. Fed by the PRIMARY What's-On
// spine (/api/whats-on) — same source as the map Tonight lane. Tolerant of a
// quiet upstream: always assert mount + heading; only exercise filter → map
// deep-link when rows actually returned.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
});

test("the /tonight screen mounts with an honest header and provenance", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/tonight");
  expect(response?.status()).toBe(200);

  await expect(page.getByTestId("tonight-screen")).toBeVisible();
  // Without a shared location the screen speaks for the whole city, and says
  // so: "near you" is the heading it earns only once it has a locality basis
  // (tonightHeading in lib/tonight.ts).
  await expect(
    page.getByRole("heading", { name: /what.?s on across London tonight/i }),
  ).toBeVisible();

  // The screen resolves to exactly one of: list, empty, error status. Wait for
  // the loading skeleton to clear into one of those terminal states. The lane
  // note is not one of them: it rides BESIDE whichever state landed, saying
  // which lane came up short, so it is excluded rather than counted.
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(
    page.locator(".tonightStatus:not(.tonightStatusNote), .tonightList"),
  ).toHaveCount(1, { timeout: 10_000 });

  expect(errors).toEqual([]);
});

test("unknown source freshness never displays request time as checked", async ({ page }) => {
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        servedAt: "2026-07-15T21:59:59.000Z",
        sourceObservedAt: null,
        sourceFreshnessKind: "unknown",
        localityBasis: "london-default",
        asOf: null,
        rows: [
          {
            id: "quiz-unknown-freshness",
            venueId: "venue-xjf3n0",
            placeName: "The Test Arms",
            kind: "quiz",
            startsAt: "2026-07-15T20:00:00.000Z",
            title: "Quiz night",
            source: { label: "Pub listing", url: "https://example.com/quiz" },
            observedAt: "2026-07-15T21:59:59.000Z",
            confidence: "listed",
          },
        ],
      }),
    }),
  );

  await page.goto("/tonight");
  // The source cannot be dated, so the What's-On line carries no dated segment
  // and the plain sentence prints under that lane alone. Anchored on the line,
  // not on its wording.
  await expect(page.locator('[data-tonight-provenance="whats-on"]')).toHaveAttribute("data-tonight-dated", "no");
  await expect(page.locator('[data-tonight-provenance="undated-whats-on"]')).toBeVisible();
  await expect(page.getByText(/Checked 15 Jul/i)).toHaveCount(0);
});

test("filtering by kind narrows the list and rows tap into a venue", async ({
  page,
}) => {
  await page.goto("/tonight");
  await expect(page.getByTestId("tonight-screen")).toBeVisible();

  const list = page.getByTestId("tonight-list");
  // Tolerate a quiet dataset: if no list rendered (empty/error/thin), there is
  // nothing to filter — the mount test already covered the honest fallback.
  if ((await list.count()) === 0) {
    test.info().annotations.push({
      type: "note",
      description: "Upstream returned no tonight rows — filter flow skipped.",
    });
    return;
  }

  const rows = page.getByTestId("tonight-row");
  const totalRows = await rows.count();
  expect(totalRows).toBeGreaterThan(0);

  // If a kind filter chip is present (needs >1 distinct kind), clicking it must
  // not grow the visible set.
  const chips = page.locator(".tonightChip[aria-pressed='false']");
  if ((await chips.count()) > 0) {
    await chips.first().click();
    await expect(rows).not.toHaveCount(0); // an active chip always has ≥1 row
    expect(await rows.count()).toBeLessThanOrEqual(totalRows);
    // Reset to All.
    await page.locator(".tonightChip", { hasText: /^All/ }).click();
    await expect(rows).toHaveCount(totalRows);
  }

  // The first row that links into the map is a real navigation target.
  const mapLink = page.locator(".tonightRowLink[href^='/map']").first();
  if ((await mapLink.count()) > 0) {
    const href = await mapLink.getAttribute("href");
    expect(href).toMatch(/^\/map\?sel=/);
  }
});

test("location is opt-in, removable, and only used for local walk times", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__tonightLocationRequests", {
      value: 0,
      writable: true,
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          const testWindow = window as Window & { __tonightLocationRequests: number };
          testWindow.__tonightLocationRequests += 1;
          success({
            coords: {
              latitude: 51.5074,
              longitude: -0.1278,
              accuracy: 20,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-15T18:00:00.000Z",
        rows: [
          {
            id: "quiz-1",
            venueId: "venue-xjf3n0",
            placeName: "The Test Arms",
            kind: "quiz",
            startsAt: "2026-07-15T20:00:00.000Z",
            title: "Quiz night",
            source: { label: "Pub listing", url: "https://example.com/quiz" },
            observedAt: "2026-07-14T18:00:00.000Z",
            confidence: "listed",
            lat: 51.51,
            lng: -0.13,
          },
        ],
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(page.getByTestId("tonight-list")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as Window & { __tonightLocationRequests: number })
        .__tonightLocationRequests,
    ),
  ).toBe(0);
  await expect(page.getByTestId("tonight-row")).not.toContainText("min walk");

  // The location card is a collapsed quiet row until tapped — open it first.
  await page
    .getByRole("button", { name: "Walk times and last train" })
    .click();
  await page
    .getByRole("button", { name: "Share location for walk times" })
    .click();
  expect(
    await page.evaluate(() =>
      (window as Window & { __tonightLocationRequests: number })
        .__tonightLocationRequests,
    ),
  ).toBe(1);
  await expect(page.getByTestId("tonight-row")).toContainText("min walk");

  await page.getByRole("button", { name: "Remove location" }).click();
  await expect(page.getByTestId("tonight-row")).not.toContainText("min walk");
});

test("a failed listings request can be retried", async ({ page }) => {
  let requests = 0;
  // Tonight waits on both lanes, so the Out lane is held to a ready-empty
  // answer here: this test is about the What's-On retry, and a live Out body
  // would decide the screen's state instead.
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
  await page.route("**/api/whats-on?**", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ rows: [], error: "Store unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [], asOf: "2026-07-15T18:00:00.000Z" }),
    });
  });

  await page.goto("/tonight");
  await page.getByRole("button", { name: "Retry listings" }).click();
  // The retry succeeded and returned no rows, so both lanes answered with
  // nothing: an empty night, not an error, and said in the empty state's own
  // sentence rather than left as a silent room.
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute(
    "data-listings-status",
    "empty",
  );
  await expect(page.getByText(/having a quiet one tonight/i)).toBeVisible();
  await expect(page.locator('[data-tonight-provenance="whats-on"]')).toHaveText(
    /^Quiet night · /,
  );
  expect(requests).toBe(2);
});

test("mobile keeps Now as a root tab over live today and tonight", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/discover");

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  await expect(primaryNav.getByRole("link", { name: "Now", exact: true })).toBeVisible();
  await primaryNav.getByRole("link", { name: "Now", exact: true }).click();
  await expect(page).toHaveURL(/\/(today|tonight)$/);
  await page
    .getByRole("navigation", { name: "Now" })
    .getByRole("link", { name: "Tonight", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByTestId("tonight-screen")).toBeVisible();
});

// Tonight applies the spine's past-date guard to the Out lane, so this fixture
// is dated off the run instead of off a calendar date: a listing pinned to a
// day in the past is one the page is right to drop.
function playhouseEvent(now = Date.now()) {
  return {
    id: "events-tm-playhouse",
    placeName: "Soho Theatre",
    kind: "event",
    startsAt: new Date(now + 2 * 60 * 60_000).toISOString(),
    title: "A Night at the Playhouse",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    // Never the future: an observation is a thing that has happened.
    observedAt: new Date(now - 60_000).toISOString(),
    confidence: "listed",
    sourceId: "1",
  };
}

test("does not promote Out theatre rows when What's-On answered empty", async ({ page }) => {
  const event = playhouseEvent();
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        asOf: "2026-08-16T12:00:00.000Z",
        sourceObservedAt: "2026-08-16T12:00:00.000Z",
        sourceFreshnessKind: "dataset-generated",
      }),
    }),
  );
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [event],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 1, status: "ready" }],
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: "A Night at the Playhouse" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("tonight-screen")).toHaveAttribute("data-listings-status", "empty");
  await expect(page.getByText(/having a quiet one tonight/i)).toBeVisible();
});

test("a degraded Out lane still names itself beside the cards it did return", async ({
  page,
}) => {
  const event = playhouseEvent();
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [
          {
            id: "quiz-primary",
            venueId: "venue-primary",
            placeName: "The Test Arms",
            kind: "quiz",
            startsAt: event.startsAt,
            title: "Quiz night",
            source: { label: "Pub listing", url: "https://example.com/quiz" },
            observedAt: event.observedAt,
            confidence: "listed",
          },
        ],
        asOf: "2026-08-16T12:00:00.000Z",
        sourceObservedAt: "2026-08-16T12:00:00.000Z",
        sourceFreshnessKind: "dataset-generated",
      }),
    }),
  );
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "degraded",
        events: [event],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "skiddle", configured: true, rows: 0, status: "degraded" }],
        reason: "Some listings could not be checked.",
      }),
    }),
  );

  await page.goto("/tonight");
  await expect(
    page.getByRole("heading", { name: "A Night at the Playhouse" }),
  ).toBeVisible({ timeout: 10_000 });
  // Cards show, so the error block never renders. Without this note the short
  // list reads as a quiet city rather than a lane we could not check.
  await expect(page.locator('[data-tonight-listings-note="partial"]')).toHaveText(
    "Some listings could not be checked.",
  );
});

test("a hung Out read settles instead of pinning the loading skeleton", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/whats-on?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        asOf: "2026-08-16T12:00:00.000Z",
        sourceObservedAt: "2026-08-16T12:00:00.000Z",
        sourceFreshnessKind: "dataset-generated",
      }),
    }),
  );
  // Never answered, never refused: the shape a CDN or edge hang takes. Tonight
  // waits on both lanes, so an Out read with no ceiling of its own would hold
  // the skeleton for the rest of the session over a night What's-On already
  // described.
  await page.route("**/api/out?**", () => {});

  // "load" would wait on the request that is deliberately never answered.
  await page.goto("/tonight", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 30_000 });
  const screen = page.getByTestId("tonight-screen");
  await expect(screen).not.toHaveAttribute("data-listings-status", "idle");
  await expect(page.getByRole("button", { name: "Retry listings" })).toBeVisible();
});
