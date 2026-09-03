import { test, expect, type Page } from "@playwright/test";

// §10 business-state matrix (client half). Every enumerated storage state the
// composer can hydrate from must fail SOFT: /plan always renders its composer,
// never a crash or a page error, and a malformed/expired/oversized/unknown
// envelope is ignored rather than throwing. Data-driven over one fixture helper
// (per the L20 right-size note) instead of 20 hand-rolled tests.
//
// Scope: the deterministic CLIENT storage states (1–14, 390 + 1440). The
// server/generation states (grounding-proof expiry, idempotent replay, one/three
// -Stop persistence, member-capability variants — §10 rows 15–20) need live
// anchored generation the keyless e2e can't produce deterministically; those stay
// covered by L07/L09/L10 unit suites and plan-privacy(-member) e2e.

const INTENT_KEY = "pubmax:planning-intent:v1";
const PLAN_DRAFT_V1 = "pubmaxx:plan-draft:v1";
const PLAN_DRAFT_V2 = "pubmax:plan-draft:v2";
const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const COMPOSER_HEADING = "Describe the outing. We’ll put it in order.";

type Seed = {
  session?: Record<string, string>;
  local?: Record<string, string>;
  dnt?: boolean;
  poisonStorage?: boolean;
};

type StateFixture = { name: string; seed: Seed };

function validIntentJson(): string {
  const now = Date.now();
  return JSON.stringify({
    version: 1,
    source: "near",
    cityId: "london",
    acceptedVenueId: "venue-statematrix",
    acceptedArea: { kind: "night-patch", id: "soho" },
    startsAt: null,
    displayEvidence: { kind: "price", observedAt: null },
    acceptedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  });
}

function expiredIntentJson(): string {
  const acceptedAt = Date.now() - 3 * 60 * 60 * 1000;
  return JSON.stringify({
    version: 1,
    source: "near",
    cityId: "london",
    acceptedVenueId: "venue-expired",
    acceptedArea: null,
    startsAt: null,
    displayEvidence: { kind: "price", observedAt: null },
    acceptedAt: new Date(acceptedAt).toISOString(),
    expiresAt: new Date(acceptedAt + 2 * 60 * 60 * 1000).toISOString(),
  });
}

const STATES: StateFixture[] = [
  { name: "clean signed-out storage", seed: {} },
  { name: "valid restored PlanningIntent", seed: { session: { [INTENT_KEY]: validIntentJson() } } },
  { name: "expired PlanningIntent", seed: { session: { [INTENT_KEY]: expiredIntentJson() } } },
  { name: "malformed PlanningIntent (bad JSON)", seed: { session: { [INTENT_KEY]: "{not json" } } },
  { name: "oversized PlanningIntent (>4KB)", seed: { session: { [INTENT_KEY]: `{"version":1,"pad":"${"x".repeat(5000)}"}` } } },
  { name: "unsupported intent version", seed: { session: { [INTENT_KEY]: validIntentJson().replace('"version":1', '"version":2') } } },
  { name: "legacy (v1) Plan draft", seed: { session: { [PLAN_DRAFT_V1]: JSON.stringify({ title: "Legacy", stops: [] }) } } },
  { name: "existing V2 Plan draft", seed: { session: { [PLAN_DRAFT_V2]: JSON.stringify({ storageVersion: 2, savedAt: new Date().toISOString(), origin: "manual", draft: { title: "Newer", stops: [] } }) } } },
  { name: "consent granted", seed: { local: { [CONSENT_KEY]: "granted" } } },
  { name: "consent denied (absent)", seed: {} },
  { name: "Do-Not-Track enabled", seed: { dnt: true } },
  { name: "storage getItem throws", seed: { poisonStorage: true } },
];

async function applySeed(page: Page, seed: Seed): Promise<void> {
  await page.addInitScript((s: Seed) => {
    try {
      if (s.dnt) {
        Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
      }
      if (s.poisonStorage) {
        const throwing = () => {
          throw new Error("storage denied");
        };
        Object.defineProperty(window, "sessionStorage", {
          configurable: true,
          get() {
            return { getItem: throwing, setItem: throwing, removeItem: throwing } as unknown as Storage;
          },
        });
        return;
      }
      for (const [k, v] of Object.entries(s.session ?? {})) window.sessionStorage.setItem(k, v);
      for (const [k, v] of Object.entries(s.local ?? {})) window.localStorage.setItem(k, v);
    } catch {
      /* seeding must not itself break the fixture */
    }
  }, seed);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const) {
  for (const state of STATES) {
    test(`${state.name} → /plan renders fail-soft at ${viewport.width}w`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.setViewportSize(viewport);
      await applySeed(page, state.seed);
      await page.goto("/plan");

      // The composer always resolves — the arbitration/parsers absorb every
      // enumerated storage state instead of throwing.
      await expect(page.getByRole("heading", { name: COMPOSER_HEADING })).toBeVisible();
      expect(pageErrors, `${state.name} must not raise a page error`).toEqual([]);
    });
  }
}
