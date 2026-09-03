import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import VenueGettingHomeTab from "@/components/map/inspector/VenueGettingHomeTab";
import {
  SAFE_NIGHT_DISMISS_PREFIX,
  SAFE_NIGHT_GETTING_HOME_SCOPE,
  SafeNightStrip,
  readSafeNightDismissed,
  resolveSafeNightDismissScope,
  safeNightDismissKey,
  writeSafeNightDismissed,
} from "@/components/night/SafeNightStrip";
import type { Venue } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";

const PLAN_ID = "11111111-2222-4333-8444-555555555555";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function installWindow(session = makeMemoryStorage()): Storage {
  const w = globalThis as { window?: unknown };
  w.window = {
    sessionStorage: session,
    localStorage: makeMemoryStorage(),
    location: { origin: "http://localhost:3000" },
    navigator: {},
  };
  return session;
}

function clearWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}

function venue(kind: Venue["kind"] = "pub"): Venue {
  return {
    id: "venue-safe-night",
    name: "The Fixture Arms",
    address: "1 Test Street",
    latitude: 51.512,
    longitude: -0.104,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    kind,
  };
}

beforeEach(() => {
  clearWindow();
});

afterEach(() => {
  clearWindow();
});

describe("SafeNightStrip dismiss scope", () => {
  it("keys plan dismiss per plan id and Getting Home on one shared scope", () => {
    expect(resolveSafeNightDismissScope(PLAN_ID)).toBe(PLAN_ID);
    expect(resolveSafeNightDismissScope(undefined)).toBe(SAFE_NIGHT_GETTING_HOME_SCOPE);
    expect(resolveSafeNightDismissScope("not-a-uuid")).toBeNull();
    expect(safeNightDismissKey(SAFE_NIGHT_GETTING_HOME_SCOPE)).toBe(
      `${SAFE_NIGHT_DISMISS_PREFIX}${SAFE_NIGHT_GETTING_HOME_SCOPE}`,
    );
  });

  it("persists hide-for-tonight in sessionStorage for Getting Home", () => {
    const session = installWindow();
    expect(readSafeNightDismissed(SAFE_NIGHT_GETTING_HOME_SCOPE)).toBe(false);
    writeSafeNightDismissed(SAFE_NIGHT_GETTING_HOME_SCOPE);
    expect(session.getItem(safeNightDismissKey(SAFE_NIGHT_GETTING_HOME_SCOPE))).toBe("1");
    expect(readSafeNightDismissed(SAFE_NIGHT_GETTING_HOME_SCOPE)).toBe(true);
  });
});

describe("SafeNightStrip Getting Home mount", () => {
  it("mounts calm get-home tools without a plan id or Night Mode", () => {
    const html = renderToStaticMarkup(
      createElement(SafeNightStrip, {
        venue: {
          id: "venue-safe-night",
          name: "The Fixture Arms",
          latitude: 51.512,
          longitude: -0.104,
        },
        cityId: "london",
      }),
    );

    expect(html).toContain('aria-label="Look after each other"');
    expect(html).toContain("Share this pin");
    expect(html).toContain("Hide for tonight");
    expect(html).toContain('href="tel:999"');
    expect(html).toContain('href="tel:116123"');
    expect(html).toContain("Plan a journey on TfL");
    expect(html).toContain("tfl.gov.uk/plan-a-journey");
    expect(html).toContain("Live trains and buses for this pin sit above.");
    expect(html).not.toContain("Share plan link");
    expect(html).not.toContain("!");
    expect(html).not.toContain("\u2014");
    expect(html).not.toContain("stranger");
    expect(html).not.toContain("presence");
  });

  it("keeps the plan share path for Night Mode", () => {
    const html = renderToStaticMarkup(
      createElement(SafeNightStrip, { planId: PLAN_ID }),
    );

    expect(html).toContain("Share plan link");
    expect(html).toContain("Share your live plan link with someone who is not out tonight.");
    expect(html).not.toContain("Share this pin");
    expect(html).not.toContain("Plan a journey on TfL");
  });

  it("uses honest getting-home copy outside London without claiming live trains", () => {
    const html = renderToStaticMarkup(
      createElement(SafeNightStrip, {
        venue: {
          id: "venue-mcr-1lwo5lo",
          name: "The Northern Fixture",
          latitude: 53.48,
          longitude: -2.24,
        },
        cityId: "manchester",
      }),
    );

    expect(html).toContain("Getting-home times for this pin sit above.");
    expect(html).not.toContain("Live trains");
    expect(html).not.toContain("TfL");
    expect(html).not.toContain("tfl.gov.uk");
  });

  it("shares the product pin URL, not Google Maps", () => {
    const origin = "http://localhost:3000";
    const url = new URL(venueMapUrl("venue-safe-night"), origin).toString();

    expect(url).toBe("http://localhost:3000/map?sel=venue-safe-night");
    expect(url).not.toContain("google.com/maps");

    const cityUrl = new URL(venueMapUrl("venue-mcr-1lwo5lo"), origin).toString();
    expect(cityUrl).toBe("http://localhost:3000/map/manchester?sel=venue-mcr-1lwo5lo");
  });

  it("returns nothing once Getting Home hide-for-tonight is set", () => {
    installWindow();
    writeSafeNightDismissed(SAFE_NIGHT_GETTING_HOME_SCOPE);

    const html = renderToStaticMarkup(
      createElement(SafeNightStrip, {
        venue: {
          id: "venue-safe-night",
          name: "The Fixture Arms",
          latitude: 51.512,
          longitude: -0.104,
        },
        cityId: "london",
      }),
    );

    expect(html).toBe("");
  });

  it("returns nothing once a plan hide-for-tonight is set", () => {
    installWindow();
    writeSafeNightDismissed(PLAN_ID);

    const html = renderToStaticMarkup(
      createElement(SafeNightStrip, { planId: PLAN_ID }),
    );

    expect(html).toBe("");
  });
});

describe("VenueGettingHomeTab Safe Night", () => {
  it("mounts the strip on the Getting Home tab without a plan id", () => {
    const html = renderToStaticMarkup(
      createElement(VenueGettingHomeTab, {
        venue: venue("pub"),
        tab: "getting-home",
        cityId: "london",
        onDecision: () => {},
      }),
    );

    expect(html).toContain('aria-label="Look after each other"');
    expect(html).toContain("Share this pin");
    expect(html).toContain("Hide for tonight");
    expect(html).toContain("Plan a journey on TfL");
  });

  it("does not mount the strip while another tab is selected", () => {
    const html = renderToStaticMarkup(
      createElement(VenueGettingHomeTab, {
        venue: venue("pub"),
        tab: "overview",
        cityId: "london",
        onDecision: () => {},
      }),
    );

    expect(html).not.toContain("Look after each other");
    expect(html).not.toContain("Share this pin");
  });

  it("honours a Getting Home dismiss across remounts", () => {
    installWindow();
    writeSafeNightDismissed(SAFE_NIGHT_GETTING_HOME_SCOPE);

    const html = renderToStaticMarkup(
      createElement(VenueGettingHomeTab, {
        venue: venue("pub"),
        tab: "getting-home",
        cityId: "london",
        onDecision: () => {},
      }),
    );

    expect(html).not.toContain("Look after each other");
    expect(html).toContain("Checking live trains");
    expect(html).toContain("Buses nearby");
  });
});
