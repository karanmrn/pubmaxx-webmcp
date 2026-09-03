import { describe, expect, it } from "vitest";

import {
  buildLogNearbyCandidates,
  clearMapLogIntentSearch,
  formatLogNearbyDistance,
  hasMapLogIntent,
  resolveLogNearbyOrigin,
  resolveMapLogIntent,
  shouldRunMapLogIntent,
  LOG_NEARBY_MAX_KM,
} from "@/lib/mapLogIntent";

describe("resolveMapLogIntent", () => {
  it("does nothing when the URL has no log intent", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: false,
        loaded: true,
        selectedVenueId: "selected",
        selectedVenueResolvable: true,
        selectedVenueIsPub: true,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "inactive" });
  });

  it("waits for the map venue list before resolving log intent", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: false,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        selectedVenueIsPub: false,
        firstRouteId: "",
        firstFilteredVenueId: "",
      }),
    ).toEqual({ status: "pending" });
  });

  it("preserves selected venue for auto-open, otherwise shows the nearby picker", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "selected",
        selectedVenueResolvable: true,
        selectedVenueIsPub: true,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "open", venueId: "selected" });

    // Wave H2: never auto-pick first route / first filtered venue.
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        selectedVenueIsPub: false,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "fallback" });

    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        selectedVenueIsPub: false,
        firstRouteId: "",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "fallback" });
  });

  it("falls back instead of opening a selected non-pub venue", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bar-selected",
        selectedVenueResolvable: true,
        selectedVenueIsPub: false,
        firstRouteId: "",
        firstFilteredVenueId: "",
      }),
    ).toEqual({ status: "fallback" });
  });

  it("asks for a pub selection when log intent cannot resolve a venue", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        selectedVenueIsPub: false,
        firstRouteId: "",
        firstFilteredVenueId: "",
      }),
    ).toEqual({ status: "fallback" });
  });

  it("falls back when the selected venue is unresolved (Wave H2 trust)", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bad-id",
        selectedVenueResolvable: false,
        selectedVenueIsPub: false,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "fallback" });

    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bad-id",
        selectedVenueResolvable: false,
        selectedVenueIsPub: false,
        firstRouteId: "",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "fallback" });
  });

  it("shows fallback instead of handling an unresolved selected venue with no fallback venue", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bad-id",
        selectedVenueResolvable: false,
        selectedVenueIsPub: false,
        firstRouteId: "",
        firstFilteredVenueId: "",
      }),
    ).toEqual({ status: "fallback" });
  });
});

describe("hasMapLogIntent", () => {
  it("parses reactive query strings without matching lookalike params", () => {
    expect(hasMapLogIntent("?log=1")).toBe(true);
    expect(hasMapLogIntent("sel=pub-1&log=1")).toBe(true);
    expect(hasMapLogIntent("?catalog=1")).toBe(false);
    expect(hasMapLogIntent("?log=0")).toBe(false);
  });
});

// D4 — closing either surface must leave no `log` param, so the picker cannot
// rearm on the next close.
describe("clearMapLogIntentSearch", () => {
  it("leaves no log param behind", () => {
    expect(clearMapLogIntentSearch("?log=1")).toBe("");
    expect(hasMapLogIntent(clearMapLogIntentSearch("?log=1"))).toBe(false);
    expect(hasMapLogIntent(clearMapLogIntentSearch("?sel=pub-1&log=1&q=camden"))).toBe(false);
  });

  it("keeps every other param the map owns", () => {
    expect(clearMapLogIntentSearch("?sel=pub-1&log=1&q=camden")).toBe("sel=pub-1&q=camden");
    expect(clearMapLogIntentSearch("?plan=1&log=1")).toBe("plan=1");
  });

  it("is a no-op on a URL that never carried the flag", () => {
    expect(clearMapLogIntentSearch("?sel=pub-1")).toBe("sel=pub-1");
    expect(clearMapLogIntentSearch("?catalog=1")).toBe("catalog=1");
    expect(clearMapLogIntentSearch("")).toBe("");
  });
});

describe("shouldRunMapLogIntent", () => {
  it("runs only while log intent is active and unhandled", () => {
    expect(shouldRunMapLogIntent({ hasLogIntent: true, handled: false })).toBe(true);
    expect(shouldRunMapLogIntent({ hasLogIntent: true, handled: true })).toBe(false);
    expect(shouldRunMapLogIntent({ hasLogIntent: false, handled: false })).toBe(false);
  });
});

describe("buildLogNearbyCandidates", () => {
  it("formats nearby pubs for the log-intent picker", () => {
    expect(
      buildLogNearbyCandidates(
        [
          { id: "a", name: "Alpha Arms", cheapestPrice: 4.5 },
          { id: "b", name: "Beta Bar", cheapestPrice: null },
          { id: "c", name: "Gamma", cheapestPrice: 6 },
          { id: "d", name: "Delta", cheapestPrice: 5 },
          { id: "e", name: "Echo", cheapestPrice: 5.2 },
          { id: "f", name: "Foxtrot", cheapestPrice: 5.5 },
        ],
        5,
      ),
    ).toEqual([
      { id: "a", name: "Alpha Arms", typeLabel: "Pub", priceLabel: "£4.50", anchor: null },
      { id: "b", name: "Beta Bar", typeLabel: "Pub", priceLabel: "Price TBD", anchor: null },
      { id: "c", name: "Gamma", typeLabel: "Pub", priceLabel: "£6.00", anchor: null },
      { id: "d", name: "Delta", typeLabel: "Pub", priceLabel: "£5.00", anchor: null },
      { id: "e", name: "Echo", typeLabel: "Pub", priceLabel: "£5.20", anchor: null },
    ]);
  });

  it("sorts by haversine distance when a GPS origin is provided (Wave K0)", () => {
    // Origin near Covent Garden; Bravo is closer than Alpha.
    const origin = { lat: 51.512, lng: -0.123 };
    const ranked = buildLogNearbyCandidates(
      [
        {
          id: "far",
          name: "Far Arms",
          cheapestPrice: 4,
          latitude: 51.55,
          longitude: -0.2,
        },
        {
          id: "near",
          name: "Near Arms",
          cheapestPrice: 5,
          latitude: 51.5125,
          longitude: -0.1235,
        },
        {
          id: "mid",
          name: "Mid Arms",
          cheapestPrice: 6,
          latitude: 51.52,
          longitude: -0.13,
        },
      ],
      3,
      origin,
    );
    expect(ranked.map((c) => c.id)).toEqual(["near", "mid", "far"]);
    expect(ranked[0].distanceKm).toBeLessThan(ranked[1].distanceKm!);
    expect(ranked[1].distanceKm).toBeLessThan(ranked[2].distanceKm!);
  });
});

describe("resolveLogNearbyOrigin", () => {
  it("falls back to the map centre when the reader gave no location", () => {
    expect(
      resolveLogNearbyOrigin({ userLocation: null, mapCenter: [-0.143, 51.539] }),
    ).toEqual({ origin: { lat: 51.539, lng: -0.143 }, source: "map" });
  });

  it("prefers a real location fix over the map centre", () => {
    expect(
      resolveLogNearbyOrigin({
        userLocation: { lat: 51.514, lng: -0.128 },
        mapCenter: [-0.143, 51.539],
      }),
    ).toEqual({ origin: { lat: 51.514, lng: -0.128 }, source: "user" });
  });

  it("reports no origin when neither is known", () => {
    expect(resolveLogNearbyOrigin({ userLocation: null, mapCenter: null })).toBeNull();
  });
});

// D1 — the shipped picker offered the same five pubs to every visitor, from
// Finchley to Bexleyheath, about twenty miles apart. The list must come from
// the area the reader is looking at.
describe("log picker shortlist follows the viewport centre", () => {
  const LONDON_PUBS = [
    { id: "finchley-usc", name: "Finchley United Services Club Ltd", latitude: 51.6, longitude: -0.187 },
    { id: "bohemia", name: "The Bohemia", latitude: 51.607, longitude: -0.185 },
    { id: "elephant", name: "The Elephant Inn", latitude: 51.593, longitude: -0.196 },
    { id: "bexley-wmc", name: "Bexleyheath Working Mens Club", latitude: 51.457, longitude: 0.147 },
    { id: "delicio", name: "Delicio (Bexleyheath)", latitude: 51.458, longitude: 0.149 },
    { id: "camden-head", name: "Camden Head", latitude: 51.539, longitude: -0.143 },
    { id: "falcon", name: "The Falcon, Camden", latitude: 51.537, longitude: -0.139 },
  ];

  function pickerFor(mapCenter: [number, number]): string[] {
    const resolved = resolveLogNearbyOrigin({ userLocation: null, mapCenter });
    return buildLogNearbyCandidates(
      LONDON_PUBS,
      undefined,
      resolved?.origin ?? null,
      LOG_NEARBY_MAX_KM,
    ).map((candidate) => candidate.id);
  }

  it("offers Camden pubs over a Camden viewport", () => {
    expect(pickerFor([-0.143, 51.539])).toEqual(["camden-head", "falcon"]);
  });

  it("offers Bexleyheath pubs over a Bexleyheath viewport", () => {
    expect(pickerFor([0.148, 51.457])).toEqual(["bexley-wmc", "delicio"]);
  });

  it("offers nothing rather than a distant pub the reader cannot be in", () => {
    // Mid-Channel: every London pub is far away, so the honest list is empty.
    expect(pickerFor([1.2, 50.6])).toEqual([]);
  });

  it("keeps the plain filtered order when no origin is known", () => {
    expect(
      buildLogNearbyCandidates(LONDON_PUBS, undefined, null, LOG_NEARBY_MAX_KM).map((c) => c.id),
    ).toEqual(["finchley-usc", "bohemia", "elephant", "bexley-wmc", "delicio"]);
  });
});

describe("formatLogNearbyDistance", () => {
  it("formats metres under 1 km and one-decimal km above", () => {
    expect(formatLogNearbyDistance(0.12)).toBe("120 m");
    expect(formatLogNearbyDistance(1.25)).toBe("1.3 km");
    expect(formatLogNearbyDistance(Number.NaN)).toBe("");
  });
});
