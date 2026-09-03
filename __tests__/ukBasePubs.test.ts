import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOUNDS_PAD_RATIO,
  MAX_PAN_PREFETCH_SHARDS,
  MAX_RESIDENT_SHARDS,
  PAN_AHEAD_PAD_RATIO,
  UK_BASE_ID_PREFIX,
  UK_BASE_MANIFEST_PATH,
  createUkBaseLoader,
  isUkBaseId,
  padBounds,
  padBoundsForPan,
  panDeltaBetween,
  parseUkBaseManifest,
  parseUkBaseShard,
  selectPanPrefetchShards,
  ukBasePubsForDrawableVenues,
  ukBaseIdFor,
  ukBasePubFromFeature,
  ukBasePubsToGeoJSON,
} from "@/lib/ukBasePubs";

// A synthetic three-cell grid. The cells are disjoint so "which cells does this
// viewport need" is exact, and one of them is deliberately far away so an
// eviction can be observed without ambiguity.
const MANIFEST = {
  version: 1,
  urlPrefix: "/data/uk_base/",
  shards: [
    { id: "a", core: false, count: 2, bbox: [-0.2, 51.4, -0.1, 51.5] },
    { id: "b", core: false, count: 1, bbox: [-0.1, 51.4, 0.0, 51.5] },
    { id: "far", core: false, count: 1, bbox: [-2.3, 53.4, -2.2, 53.5] },
  ],
};

const BODIES: Record<string, unknown> = {
  [UK_BASE_MANIFEST_PATH]: MANIFEST,
  "/data/uk_base/a.json": {
    version: 1,
    cell: "a",
    pubs: [
      ["n1", "The Anchor", "1 Dock Road", 51.42, -0.18, "venue-owner"],
      ["w2", "The Bell", "", 51.44, -0.12, ""],
    ],
  },
  "/data/uk_base/b.json": {
    version: 1,
    cell: "b",
    pubs: [["n3", "The Crown", "3 High Street", 51.45, -0.05, ""]],
  },
  "/data/uk_base/far.json": {
    version: 1,
    cell: "far",
    pubs: [["n4", "The Deansgate", "", 53.47, -2.24, ""]],
  },
};

describe("UK base ids", () => {
  it("salts OSM refs so a base pub can never collide with a curated venue id", () => {
    expect(ukBaseIdFor("n251829660")).toBe("venue-uk-n251829660");
    expect(isUkBaseId("venue-uk-n251829660")).toBe(true);
    // The curated id shape the slim index emits.
    expect(isUkBaseId("venue-7l4pei")).toBe(false);
    expect(UK_BASE_ID_PREFIX.startsWith("venue-")).toBe(true);
  });

  it("stays inside the 64-character venue id cap the price writers enforce", () => {
    // The longest OSM ids in use are 11 digits plus a type letter.
    expect(ukBaseIdFor("n99999999999").length).toBeLessThanOrEqual(64);
  });
});

describe("parseUkBaseShard", () => {
  it("turns tuple rows into pubs with salted ids", () => {
    expect(parseUkBaseShard(BODIES["/data/uk_base/a.json"])).toEqual([
      {
        id: "venue-uk-n1",
        name: "The Anchor",
        address: "1 Dock Road",
        lat: 51.42,
        lng: -0.18,
        curatedVenueId: "venue-owner",
      },
      {
        id: "venue-uk-w2",
        name: "The Bell",
        address: "",
        lat: 51.44,
        lng: -0.12,
        curatedVenueId: "",
      },
    ]);
  });

  it("drops malformed rows rather than poisoning the map", () => {
    const pubs = parseUkBaseShard({
      pubs: [
        ["n1", "Good", "", 51.4, -0.1, ""],
        ["n2", "", "", 51.4, -0.1, ""], // no name
        ["n3", "Bad coords", "", "51.4", -0.1, ""],
        ["n4", "Too short", 51.4],
        ["n5", "Bad owner", "", 51.4, -0.1, 42],
        null,
      ],
    });
    expect(pubs.map((p) => p.name)).toEqual(["Good"]);
  });

  it("is honest-empty on a non-object or shapeless payload", () => {
    expect(parseUkBaseShard(null)).toEqual([]);
    expect(parseUkBaseShard({ pubs: "nope" })).toEqual([]);
    expect(parseUkBaseShard([])).toEqual([]);
  });
});

describe("parseUkBaseManifest", () => {
  it("expands compact shard entries before shared manifest validation", () => {
    expect(parseUkBaseManifest(MANIFEST)?.shards.map((shard) => shard.url)).toEqual([
      "/data/uk_base/a.json",
      "/data/uk_base/b.json",
      "/data/uk_base/far.json",
    ]);
  });

  it.each([
    { ...MANIFEST, urlPrefix: undefined },
    { ...MANIFEST, urlPrefix: "/data/venues_slim/" },
    {
      ...MANIFEST,
      shards: [{ ...MANIFEST.shards[0], url: "/data/uk_base/wrong.json" }],
    },
    {
      ...MANIFEST,
      shards: [{ ...MANIFEST.shards[0], id: "../escape" }],
    },
  ])("rejects a compact manifest without safe derivable URLs", (manifest) => {
    expect(parseUkBaseManifest(manifest)).toBeNull();
  });
});

describe("ukBasePubsToGeoJSON", () => {
  const pubs = parseUkBaseShard(BODIES["/data/uk_base/a.json"]);

  it("carries the whole record and NOTHING the price system could read", () => {
    const [feature] = ukBasePubsToGeoJSON(pubs).features;
    expect(feature.properties).toEqual({
      id: "venue-uk-n1",
      name: "The Anchor",
      address: "1 Dock Road",
      curatedVenueId: "venue-owner",
      provisional: false,
    });
    // No bucket / price / story: the price-colour system must find nothing here.
    expect(feature.properties).not.toHaveProperty("bucket");
    expect(feature.properties).not.toHaveProperty("cheapestPrice");
    expect(feature.geometry).toEqual({ type: "Point", coordinates: [-0.18, 51.42] });
  });

  it("binds a provisional mark by stable salted base id without adding price authority", () => {
    const features = ukBasePubsToGeoJSON(
      pubs,
      new Set(["venue-uk-w2"]),
    ).features;

    expect(features[0]?.properties).toEqual({
      id: "venue-uk-n1",
      name: "The Anchor",
      address: "1 Dock Road",
      curatedVenueId: "venue-owner",
      provisional: false,
    });
    expect(features[1]?.properties).toEqual({
      id: "venue-uk-w2",
      name: "The Bell",
      address: "",
      curatedVenueId: "",
      provisional: true,
    });
    expect(features[1]?.properties).not.toHaveProperty("bucket");
    expect(features[1]?.properties).not.toHaveProperty("cheapestPrice");
    expect(features[1]?.properties).not.toHaveProperty("priceLabel");
  });

  it("suppresses only a base pub whose recorded curated owner is drawable", () => {
    expect(
      ukBasePubsForDrawableVenues(pubs, new Set(["venue-owner"])).map(
        (pub) => pub.id,
      ),
    ).toEqual(["venue-uk-w2"]);
    expect(
      ukBasePubsForDrawableVenues(
        pubs,
        new Set(["venue-somewhere-else"]),
      ).map((pub) => pub.id),
    ).toEqual(["venue-uk-n1", "venue-uk-w2"]);
  });

  it("round-trips back to the pub a tap needs", () => {
    const [feature] = ukBasePubsToGeoJSON(pubs).features;
    expect(ukBasePubFromFeature(feature)).toEqual(pubs[0]);
  });

  it("refuses a feature that is not a base pin", () => {
    expect(ukBasePubFromFeature({ properties: { id: "venue-7l4pei", name: "X" } })).toBeNull();
    expect(
      ukBasePubFromFeature({
        properties: { id: "venue-uk-n1", name: "X" },
        geometry: { type: "LineString", coordinates: [] },
      }),
    ).toBeNull();
  });
});

describe("padBounds", () => {
  it("grows the viewport by the pan-ahead ratio on both axes", () => {
    const padded = padBounds({ west: -1, south: 51, east: 1, north: 52 });
    expect(padded.west).toBeCloseTo(-1 - 2 * BOUNDS_PAD_RATIO);
    expect(padded.east).toBeCloseTo(1 + 2 * BOUNDS_PAD_RATIO);
    expect(padded.south).toBeCloseTo(51 - BOUNDS_PAD_RATIO);
    expect(padded.north).toBeCloseTo(52 + BOUNDS_PAD_RATIO);
  });
});

describe("createUkBaseLoader", () => {
  const realFetch = globalThis.fetch;
  let fetched: string[] = [];

  function installFetch(
    fail: Set<string> = new Set(),
    bodies: Record<string, unknown> = BODIES,
  ) {
    fetched = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (fail.has(url)) return Promise.reject(new Error("cellar signal"));
      if (url in bodies) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(bodies[url]) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as typeof fetch;
  }

  beforeEach(() => installFetch());
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("fetches only the cells the viewport covers, and the manifest exactly once", async () => {
    const loader = createUkBaseLoader();
    const { pubs } = await loader.pubsForBounds({
      west: -0.19,
      south: 51.42,
      east: -0.17,
      north: 51.44,
    });
    expect(pubs.map((p) => p.name).sort()).toEqual(["The Anchor", "The Bell"]);
    expect(fetched).toContain("/data/uk_base/a.json");
    // Manchester is nowhere near this viewport and must cost nothing.
    expect(fetched).not.toContain("/data/uk_base/far.json");

    fetched = [];
    await loader.pubsForBounds({ west: -0.19, south: 51.42, east: -0.17, north: 51.44 });
    expect(fetched).toEqual([]);
  });

  it("returns the whole viewport's set, not just the newly fetched cell", async () => {
    const loader = createUkBaseLoader();
    await loader.pubsForBounds({ west: -0.19, south: 51.42, east: -0.17, north: 51.44 });
    const { pubs: both } = await loader.pubsForBounds({ west: -0.15, south: 51.42, east: -0.03, north: 51.46 });
    // A source setData replaces everything, so a partial answer would blank the
    // cells the camera is still over.
    expect(both.map((p) => p.name).sort()).toEqual(["The Anchor", "The Bell", "The Crown"]);
  });

  it("degrades to no pins (and retries next time) when a cell fails", async () => {
    installFetch(new Set(["/data/uk_base/a.json"]));
    const loader = createUkBaseLoader();
    expect(await loader.pubsForBounds({ west: -0.19, south: 51.42, east: -0.17, north: 51.44 })).toEqual({
      status: "unavailable",
      pubs: [],
    });

    installFetch();
    const { pubs: retried } = await loader.pubsForBounds({ west: -0.19, south: 51.42, east: -0.17, north: 51.44 });
    expect(retried.map((p) => p.name)).toEqual(["The Anchor", "The Bell"]);
  });

  it.each([
    ["version", { ...(BODIES["/data/uk_base/a.json"] as object), version: 2 }],
    ["cell", { ...(BODIES["/data/uk_base/a.json"] as object), cell: "wrong" }],
    [
      "partial rows",
      {
        version: 1,
        cell: "a",
        pubs: [
          ["n1", "The Anchor", "1 Dock Road", 51.42, -0.18, "venue-owner"],
          ["w2", "", "", 51.44, -0.12, ""],
        ],
      },
    ],
  ])("does not cache a shard with invalid %s", async (_field, malformed) => {
    const loader = createUkBaseLoader();
    installFetch(
      new Set(),
      { ...BODIES, "/data/uk_base/a.json": malformed },
    );
    expect(
      await loader.pubsForBounds({
        west: -0.19,
        south: 51.42,
        east: -0.17,
        north: 51.44,
      }),
    ).toEqual({ status: "unavailable", pubs: [] });

    installFetch();
    const { pubs: retried } = await loader.pubsForBounds({
      west: -0.19,
      south: 51.42,
      east: -0.17,
      north: 51.44,
    });
    expect(retried.map((pub) => pub.name).sort()).toEqual(["The Anchor", "The Bell"]);
  });

  it("yields no pins at all when the manifest is unreachable", async () => {
    installFetch(new Set([UK_BASE_MANIFEST_PATH]));
    const loader = createUkBaseLoader();
    expect(
      await loader.pubsForBounds({
        west: -0.19,
        south: 51.42,
        east: -0.17,
        north: 51.44,
      }),
    ).toEqual({ status: "unavailable", pubs: [] });
  });

  it("reports a successful viewport with no matching cells as ready-empty", async () => {
    const loader = createUkBaseLoader();
    expect(
      await loader.pubsForBounds({
        west: 10,
        south: 40,
        east: 11,
        north: 41,
      }),
    ).toEqual({ status: "ready", pubs: [] });
  });

  it("find() resolves a resident pub by id and nothing else", async () => {
    const loader = createUkBaseLoader();
    await loader.pubsForBounds({ west: -0.19, south: 51.42, east: -0.17, north: 51.44 });
    expect(loader.find("venue-uk-n1")?.name).toBe("The Anchor");
    expect(loader.find("venue-uk-n4")).toBeNull(); // never loaded
    expect(loader.find("venue-7l4pei")).toBeNull(); // curated ids are not ours
  });

  it("keeps residency bounded so panning the country cannot grow the tab", () => {
    // The cap stops the country-wide pack accumulating across a long session;
    // the fetch path is exercised above, this pins the contract itself.
    expect(MAX_RESIDENT_SHARDS).toBe(12);
    expect(MAX_RESIDENT_SHARDS).toBeLessThanOrEqual(12);
    expect(MAX_PAN_PREFETCH_SHARDS).toBeGreaterThan(0);
    expect(MAX_PAN_PREFETCH_SHARDS).toBeLessThan(MAX_RESIDENT_SHARDS);
  });

  it("restorePub resolves a pub by id via the hint cell without a viewport stream", async () => {
    const loader = createUkBaseLoader();
    const pub = await loader.restorePub("venue-uk-n1", { lat: 51.42, lng: -0.18 });
    expect(pub?.name).toBe("The Anchor");
    // No hint and not resident → null (caller fails closed or asks the server).
    const cold = createUkBaseLoader();
    expect(await cold.restorePub("venue-uk-n1")).toBeNull();
    expect(await cold.restorePub("venue-uk-n0000000000", { lat: 51.42, lng: -0.18 })).toBeNull();
  });

  it("warms a pan-ahead neighbour into residency without returning it as drawn", async () => {
    const loader = createUkBaseLoader();
    // First settle over cell a only.
    await loader.pubsForBounds({
      west: -0.19,
      south: 51.42,
      east: -0.17,
      north: 51.44,
    });
    fetched = [];
    // Pan east: draw pad still only a, but the pan-ahead stretch reaches b.
    const { pubs: drawn } = await loader.pubsForBounds({
      west: -0.13,
      south: 51.42,
      east: -0.11,
      north: 51.44,
    });
    expect(drawn.map((p) => p.name).sort()).toEqual(["The Anchor", "The Bell"]);
    expect(drawn.map((p) => p.name)).not.toContain("The Crown");
    // Prefetch warmed b into residency; find must not need another fetch.
    const before = [...fetched];
    expect(loader.find("venue-uk-n3")?.name).toBe("The Crown");
    expect(fetched).toEqual(before);
    expect(before).toContain("/data/uk_base/b.json");
  });
});

describe("pan residency helpers", () => {
  it("ignores zoom-only settles and stretches only the leading pan edges", () => {
    const a = { west: -0.2, south: 51.4, east: -0.1, north: 51.5 };
    const zoomOnly = { west: -0.19, south: 51.41, east: -0.11, north: 51.49 };
    // Centres identical → no pan.
    expect(
      panDeltaBetween(a, { west: -0.2, south: 51.4, east: -0.1, north: 51.5 }),
    ).toBeNull();
    // Same centre, tighter bounds → a zoom, not a pan.
    expect(panDeltaBetween(a, zoomOnly)).toBeNull();
    const east = panDeltaBetween(a, {
      west: -0.1,
      south: 51.4,
      east: 0.0,
      north: 51.5,
    });
    expect(east?.dLng).toBeGreaterThan(0);
    const padded = padBoundsForPan(a, east);
    const plain = padBounds(a);
    expect(padded.east).toBeGreaterThan(plain.east);
    expect(padded.west).toBe(plain.west);
    expect(padded.east - plain.east).toBeCloseTo(
      Math.abs(a.east - a.west) * PAN_AHEAD_PAD_RATIO,
    );
  });

  it("selects only non-drawn shards inside the pan-ahead pad, up to budget", () => {
    const shards = [
      {
        id: "a",
        core: false,
        url: "/data/uk_base/a.json",
        count: 1,
        bbox: [-0.2, 51.4, -0.1, 51.5] as [number, number, number, number],
      },
      {
        id: "b",
        core: false,
        url: "/data/uk_base/b.json",
        count: 1,
        bbox: [-0.1, 51.4, 0.0, 51.5] as [number, number, number, number],
      },
      {
        id: "far",
        core: false,
        url: "/data/uk_base/far.json",
        count: 1,
        bbox: [-2.3, 53.4, -2.2, 53.5] as [number, number, number, number],
      },
    ];
    const drawn = new Set(["/data/uk_base/a.json"]);
    const panPad = { west: -0.2, south: 51.4, east: 0.05, north: 51.5 };
    const picked = selectPanPrefetchShards(shards, drawn, panPad, 1);
    expect(picked.map((s) => s.id)).toEqual(["b"]);
    expect(selectPanPrefetchShards(shards, drawn, panPad, 0)).toEqual([]);
  });
});
