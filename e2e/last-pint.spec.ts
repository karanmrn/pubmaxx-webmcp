import { test, expect, type Page, type Route } from "@playwright/test";

import type { LastPintDecisionKind, LastTrainResult } from "../lib/tfl";

// "Last Pint" card (components/map/LastTrainCard.tsx, app/api/last-train/route.ts,
// user stories 19-24). The card lives in the venue sheet's "Last train" tab
// and fetches /api/last-train?lat=..&lng=.. client-side. We mock that one route
// per decision state via Playwright's route interception so every pub-voice
// state is exercised deterministically — real TfL/network timing never has to
// cooperate — plus one real/unmocked pass proving the card never goes blank.
//
// Style matches e2e/smoke.spec.ts / e2e/social-loop.spec.ts / e2e/map-story.spec.ts:
// watchPageErrors, web-first assertions, no waitForTimeout.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  // Every test here drives the heavy `/map` route (MapLibre + large bundles).
  // On a freshly-built production server the first requests pay a real
  // cold-start cost that can exceed the default 30s per-test budget — which is
  // why the map-driving specs in this suite (accessible-filters, crawl-routes,
  // map-console-health, …) all raise their timeout. Without this, the first
  // few tests in file order flake with an empty-locator timeout on a cold
  // webServer while everything after them (server now warm) passes. 90s matches
  // the established convention and is absorbed instantly once warm.
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// Same known seed venue ("Arnos Arms") the other new specs deep-link to.
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

// A well-formed LastTrainResult fixture per decision state — same shape the real
// /api/last-train route returns (lib/tfl.ts LastTrainResult), enough to exercise
// every branch LastTrainCard renders: station, leave-by, departures, last trains,
// and the 3 nearest pubs.
function fixtureFor(decision: LastPintDecisionKind): Partial<LastTrainResult> {
  const nowPlus = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();

  const base: Partial<LastTrainResult> = {
    station: { id: "940GZZLUARS", name: "Arnos Grove", distanceM: 320 },
    trains: [
      { lineId: "piccadilly", lineName: "Piccadilly", colour: "#0019A8", clock: "00:12", pastMidnight: true },
    ],
    departures: [
      { lineId: "piccadilly", lineName: "Piccadilly", colour: "#0019A8", times: ["23:41", "23:53", "00:05"], live: true },
    ],
    nearestPubs: [
      { id: "venue-aaa1", name: "The Arnos Tavern", price: 5.2 },
      { id: "venue-aaa2", name: "The Grove Inn", price: 5.8 },
      { id: "venue-aaa3", name: "The Piccadilly Vaults", price: 6.1 },
    ],
    generatedAt: new Date().toISOString(),
  };

  switch (decision) {
    case "order_one_more":
      return {
        ...base,
        decision: {
          decision: "order_one_more",
          leaveByIso: nowPlus(50),
          stationName: "Arnos Grove",
          lineNames: ["Piccadilly"],
          disruptionSummary: null,
          walkMinutesEstimate: 4,
          bufferMinutes: 5,
          destinationLabel: null,
          live: true,
        },
      };
    case "half_pint_only":
      return {
        ...base,
        decision: {
          decision: "half_pint_only",
          leaveByIso: nowPlus(30),
          stationName: "Arnos Grove",
          lineNames: ["Piccadilly"],
          disruptionSummary: null,
          walkMinutesEstimate: 4,
          bufferMinutes: 5,
          destinationLabel: null,
          live: true,
        },
      };
    case "settle_up_now":
      return {
        ...base,
        decision: {
          decision: "settle_up_now",
          leaveByIso: nowPlus(12),
          stationName: "Arnos Grove",
          lineNames: ["Piccadilly"],
          disruptionSummary: null,
          walkMinutesEstimate: 4,
          bufferMinutes: 5,
          destinationLabel: null,
          live: true,
        },
      };
    case "train_risk":
      return {
        ...base,
        decision: {
          decision: "train_risk",
          leaveByIso: nowPlus(2),
          stationName: "Arnos Grove",
          lineNames: ["Piccadilly"],
          disruptionSummary: "Piccadilly: Minor Delays",
          walkMinutesEstimate: 4,
          bufferMinutes: 5,
          destinationLabel: null,
          live: true,
        },
      };
    case "live_data_unavailable":
      return {
        station: base.station,
        trains: [],
        departures: [],
        nearestPubs: base.nearestPubs,
        generatedAt: new Date().toISOString(),
        decision: {
          decision: "live_data_unavailable",
          leaveByIso: null,
          stationName: "Arnos Grove",
          lineNames: [],
          disruptionSummary: null,
          walkMinutesEstimate: 0,
          bufferMinutes: 5,
          destinationLabel: null,
          live: false,
        },
      };
  }
}

// Pub-voice copy per decision (mirrors LastTrainCard's DECISION_COPY) — asserted
// against, not re-derived, so a copy regression in the card fails this test.
const DECISION_COPY: Record<LastPintDecisionKind, string> = {
  order_one_more: "Order one more",
  half_pint_only: "Half pint only",
  settle_up_now: "Settle up now",
  train_risk: "Train risk tonight",
  live_data_unavailable: "Can't check TfL right now",
};

async function openGettingHomeTab(page: Page): Promise<void> {
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);
  await page.getByRole("tab", { name: "Last train", exact: true }).click();
  await expect(page.locator("#venuePanel-getting-home")).toBeVisible();
}

const DECISION_STATES: LastPintDecisionKind[] = [
  "order_one_more",
  "half_pint_only",
  "settle_up_now",
  "train_risk",
  "live_data_unavailable",
];

test.describe("Last Pint card — decision states (mocked /api/last-train)", () => {
  for (const decisionKind of DECISION_STATES) {
    test(`${decisionKind}: renders pub-voice line, leave-by, departures, and 3 nearest pubs`, async ({
      page,
    }) => {
      const errors = watchPageErrors(page);

      await page.route("**/api/last-train**", async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(fixtureFor(decisionKind)),
        });
      });

      await openGettingHomeTab(page);

      const card = page.getByLabel("Last Pint");
      await expect(card).toBeVisible();

      // The pub-voice decision line, verbatim.
      await expect(card).toContainText(DECISION_COPY[decisionKind]);

      if (decisionKind === "live_data_unavailable") {
        // No leave-by line for the unavailable state (LastTrainCard gates it on
        // decision.decision !== "live_data_unavailable").
        await expect(card).not.toContainText("Leave by");
      } else {
        // Leave-by is present for every resolvable state.
        await expect(card).toContainText("Leave by");
        // Departures list (live next departures) renders.
        await expect(card.locator("ul").first()).toBeVisible();
      }

      // "Send to crew" share renders in every decision state (the Guardian's
      // WhatsApp-ready hand-off).
      await expect(card.getByRole("button", { name: "Send to crew" })).toBeVisible();

      // The 3 nearest pubs "by the platform" always render for a resolved
      // station, mocked or not.
      await expect(card).toContainText("One more by the platform");
      const pubItems = card.locator("ul").last().locator("li");
      await expect(pubItems).toHaveCount(3);

      expect(errors).toEqual([]);
    });
  }

  test("send to crew: shares a home-logistics message via the native share sheet", async ({
    page,
  }) => {
    // Stub navigator.share so the click resolves deterministically (no popup /
    // real share sheet) and capture the composed message text for assertions.
    await page.addInitScript(() => {
      (window as unknown as { __sharedText?: string }).__sharedText = undefined;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (data: { text?: string }) => {
          (window as unknown as { __sharedText?: string }).__sharedText = data.text;
          return Promise.resolve();
        },
      });
    });

    await page.route("**/api/last-train**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixtureFor("settle_up_now")),
      });
    });

    await openGettingHomeTab(page);
    const card = page.getByLabel("Last Pint");
    await card.getByRole("button", { name: "Send to crew" }).click();

    // Button confirms it was sent, and the shared message is home-logistics
    // framed (never a nudge to drink more).
    await expect(card.getByRole("button", { name: "Sent to crew" })).toBeVisible();
    const sharedText = await page.evaluate(
      () => (window as unknown as { __sharedText?: string }).__sharedText,
    );
    expect(sharedText).toContain("Last train home");
    expect(sharedText).toContain("Arnos Grove");
    expect(sharedText).toContain("Leave by");
    expect(sharedText).toContain("Time to settle up.");
    expect(sharedText).toContain("via PUBMAXXING");
    expect(sharedText?.toLowerCase()).not.toContain("another round");
  });

  test("train_risk: the disruption summary is surfaced", async ({ page }) => {
    await page.route("**/api/last-train**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixtureFor("train_risk")),
      });
    });
    await openGettingHomeTab(page);
    const card = page.getByLabel("Last Pint");
    await expect(card).toContainText(/minor delays/i);
  });
});

// ---------------------------------------------------------------------------
// Graceful path — the REAL (unmocked) /api/last-train, or a hard network
// failure. The route itself never 500s (see app/api/last-train/route.ts header
// comment: "This route NEVER throws and NEVER 500s the user"), and the card
// always resolves to loading -> ready or empty, never a blank panel. We assert
// the tab always renders SOMETHING recognisable, without depending on the real
// TfL API's availability in CI.
test.describe("Last Pint card — unmocked graceful path", () => {
  test("getting-home tab never renders blank: real API or a hard failure still shows the Last Pint card", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await openGettingHomeTab(page);

    const card = page.getByLabel("Last Pint");
    await expect(card).toBeVisible();

    // One of: still loading, the friendly TfL-unreachable note, or a resolved
    // decision line — any one proves the card is never an empty shell. Poll so
    // we don't snapshot mid-fetch.
    await expect
      .poll(async () => (await card.innerText()).trim().length)
      .toBeGreaterThan("Last Pint".length);

    expect(errors).toEqual([]);
  });

  test("getting-home tab still shows the card when /api/last-train hard-fails (network error)", async ({
    page,
  }) => {
    await page.route("**/api/last-train**", (route) => route.abort("failed"));
    await openGettingHomeTab(page);

    const card = page.getByLabel("Last Pint");
    await expect(card).toBeVisible();
    // toState()/the catch handler both resolve to the "empty" friendly note —
    // never a blank card.
    await expect(card).toContainText(/couldn.?t reach tfl/i);
  });
});
