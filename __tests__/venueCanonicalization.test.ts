import { describe, it, expect } from "vitest";

import {
  canonicalizeDataset,
  clusterHasPostcodeConflict,
  hasOperatorSuffix,
  mergeAliasMaps,
  namesLikelySamePub,
  normalizeVenueIdentityName,
  postcodeOutward,
  significantNameTokens,
  stableVenueIdFromKey,
  venueGroupingKey,
} from "@/scripts/lib/venueCanonicalization.mjs";
import {
  groupVenuePrices,
  stableVenueIdFromKey as tsStableVenueIdFromKey,
  venueGroupingKey as tsVenueGroupingKey,
  type VenuePrice,
} from "@/lib/venues";

// A row factory mirroring __tests__/venues.test.ts so canonicalized rows can be
// fed straight into groupVenuePrices for the regression assertion.
function makeRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 6,
    price_text: "",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "",
    source_row_count: 1,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

// The verified real-world duplicate pair: the same Stoke Newington pub carried
// twice — a seed record and a Wetherspoons-directory record — with different
// addresses, geocodes and price sets.
const ROCHESTER_SEED = makeRow({
  app_price_id: "app_price_001091",
  pub_name: "The Rochester Castle",
  pint_name: "BUD LIGHT",
  price_gbp: 1.99,
  address: "143-145 Stoke Newington High Street, , Stoke Newington, England",
  latitude: 51.561,
  longitude: -0.073976,
  primary_borough: "Hackney",
  source_datasets: "canonical_borough_leaderboard_enriched|borough_embedded_map_data_raw",
});
const ROCHESTER_SPOONS = makeRow({
  app_price_id: "app_price_001099",
  pub_name: "The Rochester Castle - JD Wetherspoon",
  pint_name: "BUD LIGHT",
  price_gbp: 2.43,
  address: "143-145 Stoke Newington High St, London N16 0NY, UK",
  latitude: 51.5609,
  longitude: -0.074042,
  primary_borough: "Hackney",
  source_datasets:
    "canonical_borough_leaderboard_enriched|borough_embedded_map_data_raw|individual_pub_page",
});

describe("normalizeVenueIdentityName", () => {
  it("collapses the Wetherspoons lineage onto the clean pub name", () => {
    expect(normalizeVenueIdentityName("The Rochester Castle")).toBe("rochester castle");
    expect(normalizeVenueIdentityName("The Rochester Castle - JD Wetherspoon")).toBe(
      "rochester castle",
    );
    expect(normalizeVenueIdentityName("The Furze Wren (Wetherspoons)")).toBe("furze wren");
  });

  it("drops locality qualifiers and folds punctuation / articles", () => {
    expect(normalizeVenueIdentityName("George (Southwark)")).toBe("george");
    expect(normalizeVenueIdentityName("The George")).toBe("george");
    expect(normalizeVenueIdentityName("Hope & Anchor")).toBe("hope and anchor");
    expect(normalizeVenueIdentityName("McGlynn’s Free House")).toBe(
      normalizeVenueIdentityName("McGlynn's Free House"),
    );
  });
});

describe("hasOperatorSuffix", () => {
  it("flags brewery/operator marketing suffixes only", () => {
    expect(hasOperatorSuffix("The Rochester Castle - JD Wetherspoon")).toBe(true);
    expect(hasOperatorSuffix("The Furze Wren (Wetherspoons)")).toBe(true);
    expect(hasOperatorSuffix("The Rochester Castle")).toBe(false);
    expect(hasOperatorSuffix("George (Southwark)")).toBe(false);
  });
});

describe("postcodeOutward", () => {
  it("extracts the outward code, or null when absent", () => {
    expect(postcodeOutward("143-145 Stoke Newington High St, London N16 0NY, UK")).toBe("N16");
    expect(postcodeOutward("29 Greek St, London W1D 5DH")).toBe("W1D");
    expect(postcodeOutward("143-145 Stoke Newington High Street, , Stoke Newington, England")).toBe(
      null,
    );
  });
});

describe("canonicalizeDataset — Rochester Castle merge", () => {
  it("merges the pair into the clean-named canonical id with an alias", () => {
    const seedKey = venueGroupingKey(ROCHESTER_SEED);
    const spoonsKey = venueGroupingKey(ROCHESTER_SPOONS);
    const seedId = stableVenueIdFromKey(seedKey);
    const spoonsId = stableVenueIdFromKey(spoonsKey);
    expect(seedId).not.toBe(spoonsId); // two identities before canonicalization

    const { rows, aliases, stats } = canonicalizeDataset([ROCHESTER_SEED, ROCHESTER_SPOONS]);

    // The clean seed name (no operator suffix) wins as canonical.
    expect(aliases).toEqual({ [spoonsId]: seedId });
    expect(stats.duplicateClusters).toBe(1);
    expect(stats.mergedRecords).toBe(1);
    expect(stats.venueIdentitiesAfter).toBe(1);

    // Both rows now carry the canonical identity fields...
    expect(rows.every((r) => r.pub_name === "The Rochester Castle")).toBe(true);
    expect(rows.every((r) => r.latitude === 51.561 && r.longitude === -0.073976)).toBe(true);
    // ...but each keeps its own price + provenance (no averaging, no invention).
    const prices = rows.map((r) => r.price_gbp).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(prices).toEqual([1.99, 2.43]);
    const spoonsRow = rows.find((r) => r.app_price_id === "app_price_001099")!;
    expect(spoonsRow.source_datasets).toContain("individual_pub_page");
    expect(spoonsRow.price_gbp).toBe(2.43);
  });

  it("regression: grouping the canonicalized rows yields ONE venue, never two", () => {
    const { rows } = canonicalizeDataset([ROCHESTER_SEED, ROCHESTER_SPOONS]);
    const venues = groupVenuePrices(rows);

    expect(venues).toHaveLength(1);
    const ids = venues.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length); // no two entries share a canonical id
    expect(venues[0].name).toBe("The Rochester Castle");
    expect(venues[0].cheapestPrice).toBe(1.99); // cheapest across the union
    expect(venues[0].prices).toHaveLength(2); // both price rows preserved
  });
});

describe("canonicalizeDataset — safety guards", () => {
  it("does NOT merge same-named pubs with conflicting postcodes (bad coords)", () => {
    // Two "Coach & Horses" mis-geocoded within 100 m but in different postcode
    // areas (Soho W1D vs Rickmansworth WD3) — genuinely distinct pubs.
    const soho = makeRow({
      pub_name: "The Coach & Horses",
      address: "29 Greek St, London W1D 5DH",
      latitude: 51.5133,
      longitude: -0.130129,
    });
    const rickmansworth = makeRow({
      pub_name: "The Coach & Horses",
      address: "Rickmansworth WD3 1ER",
      latitude: 51.5139,
      longitude: -0.129688,
    });
    const { aliases, stats } = canonicalizeDataset([soho, rickmansworth]);
    expect(aliases).toEqual({});
    expect(stats.duplicateClusters).toBe(0);
  });

  it("does NOT merge same-named pubs more than 100 m apart", () => {
    const a = makeRow({ pub_name: "The Crown", latitude: 51.5, longitude: -0.1 });
    const b = makeRow({ pub_name: "The Crown", latitude: 51.52, longitude: -0.1 }); // ~2.2 km
    const { aliases, stats } = canonicalizeDataset([a, b]);
    expect(aliases).toEqual({});
    expect(stats.duplicateClusters).toBe(0);
  });

  it("leaves a duplicate-free dataset untouched (idempotent shape)", () => {
    const rows = [makeRow({ pub_name: "The Solo Arms", address: "1 Only Rd, London E1 1AA" })];
    const { rows: out, aliases, stats } = canonicalizeDataset(rows);
    expect(aliases).toEqual({});
    expect(stats.venueIdentitiesAfter).toBe(1);
    expect(out).toEqual(rows);
  });

  it("does NOT transitively collapse an A-B-C chain when the endpoints exceed 100 m", () => {
    // A-B (~89 m) and B-C (~89 m) individually satisfy the merge predicate, but
    // A-C (~178 m) does not — single-link clustering must not chain all three
    // into one merged identity via B; C must stay a distinct venue.
    const a = makeRow({ pub_name: "The Anchor", latitude: 51.5, longitude: -0.1 });
    const b = makeRow({ pub_name: "The Anchor", latitude: 51.5008, longitude: -0.1 });
    const c = makeRow({ pub_name: "The Anchor", latitude: 51.5016, longitude: -0.1 });
    const cId = stableVenueIdFromKey(venueGroupingKey(c));

    const { aliases, stats } = canonicalizeDataset([a, b, c]);

    // At most the A-B pair merges; C is never folded into that cluster.
    expect(stats.duplicateClusters).toBeLessThanOrEqual(1);
    expect(Object.keys(aliases)).not.toContain(cId);
    expect(Object.values(aliases)).not.toContain(cId);
  });
});

describe("canonicalizeDataset — idempotency", () => {
  it("running canonicalization on its own output is a no-op (zero new clusters/aliases)", () => {
    const first = canonicalizeDataset([ROCHESTER_SEED, ROCHESTER_SPOONS]);
    expect(first.stats.duplicateClusters).toBe(1);

    const second = canonicalizeDataset(first.rows);
    expect(second.aliases).toEqual({});
    expect(second.stats.duplicateClusters).toBe(0);
    expect(second.stats.mergedRecords).toBe(0);
    expect(second.rows).toEqual(first.rows);
  });
});

describe("compareCanonical — address-completeness tiebreak", () => {
  it("prefers the record with a postcode as canonical when suffix/rows/sources/parens all tie", () => {
    const noPostcode = makeRow({
      pub_name: "The George",
      address: "1 High Street, England",
      latitude: 51.5,
      longitude: -0.1,
    });
    const withPostcode = makeRow({
      pub_name: "The George",
      address: "1 High Street, London E1 1AA",
      latitude: 51.500001,
      longitude: -0.1,
    });
    const noPostcodeId = stableVenueIdFromKey(venueGroupingKey(noPostcode));
    const withPostcodeId = stableVenueIdFromKey(venueGroupingKey(withPostcode));

    const { aliases, rows } = canonicalizeDataset([noPostcode, withPostcode]);

    expect(aliases).toEqual({ [noPostcodeId]: withPostcodeId });
    expect(rows.every((r) => r.address === "1 High Street, London E1 1AA")).toBe(true);
  });
});

describe("clusterHasPostcodeConflict", () => {
  it("flags a cluster whose members carry two different outward codes", () => {
    const a = { address: "1 High St, London N16 0NY" };
    const b = { address: "1 High St, London SW1A 1AA" };
    expect(clusterHasPostcodeConflict([a, b])).toBe(true);
  });

  it("does not flag a cluster where only one member (or none) carries a postcode", () => {
    const a = { address: "1 High St, England" };
    const b = { address: "1 High St, London N16 0NY" };
    expect(clusterHasPostcodeConflict([a, b])).toBe(false);
    expect(clusterHasPostcodeConflict([{ address: "no postcode here" }])).toBe(false);
  });
});

describe("canonicalizeDataset — postcode-bridge over-merge guard", () => {
  it("does NOT chain two postcode-conflicting records via a postcode-less bridge", () => {
    // Same normalized name, all within 100 m of each other. A (N16) and C (W1D)
    // have conflicting outward codes, so they are genuinely distinct pubs; B
    // carries no postcode. Pairwise A-B and B-C each satisfy looksSamePub (a
    // missing postcode never blocks), so a single-link/bridge cluster would
    // wrongly fold A, B and C together. The cluster-wide guard must keep the
    // two conflicting postcodes from ever landing in the same merged identity.
    const a = makeRow({
      pub_name: "The Bell",
      address: "1 Bell St, London N16 0NY",
      latitude: 51.5,
      longitude: -0.1,
    });
    const b = makeRow({
      pub_name: "The Bell",
      address: "1 Bell St, England",
      latitude: 51.5001,
      longitude: -0.1,
    });
    const c = makeRow({
      pub_name: "The Bell",
      address: "1 Bell St, London W1D 5DH",
      latitude: 51.5002,
      longitude: -0.1,
    });
    const aId = stableVenueIdFromKey(venueGroupingKey(a));
    const cId = stableVenueIdFromKey(venueGroupingKey(c));

    const { aliases } = canonicalizeDataset([a, b, c]);

    // The two conflicting-postcode records must never share a canonical id.
    const resolve = (id: string) => aliases[id] ?? id;
    expect(resolve(aId)).not.toBe(resolve(cId));
  });
});

describe("namesLikelySamePub + significantNameTokens", () => {
  it("strips generic descriptor tokens", () => {
    expect(significantNameTokens("kings head tavern")).toEqual(["kings", "head"]);
    expect(significantNameTokens("the wine bar")).toEqual(["wine"]);
    expect(significantNameTokens("ye olde cheshire cheese")).toEqual(["cheshire", "cheese"]);
  });

  it("matches identical names and rejects disjoint names", () => {
    expect(namesLikelySamePub("moon on the hill", "moon on the hill")).toBe(true);
    expect(namesLikelySamePub("red lion", "slug and lettuce")).toBe(false);
  });

  it("matches a name that is the other plus a qualifier suffix", () => {
    expect(namesLikelySamePub("kings head", "kings head tavern")).toBe(true);
    expect(namesLikelySamePub("coach and horses", "coach and horses pub")).toBe(true);
    expect(namesLikelySamePub("old hat", "old hat ealing")).toBe(true); // locality suffix
    expect(namesLikelySamePub("canonbury", "canonbury tavern")).toBe(true); // 1-token core + generic
  });

  it("rejects two distinct pubs sharing a locality but differing in type word", () => {
    // The real false-merge from the dataset: "New Cross Inn" and "The New Cross
    // House" are different pubs — neither full token set contains the other.
    expect(namesLikelySamePub("new cross inn", "new cross house")).toBe(false);
  });

  it("keeps a single shared distinctive token from collapsing distinct pubs", () => {
    // "The Bell" vs "The Bell and Crown" — the longer name adds a DISTINCTIVE
    // token ("crown"), so they are treated as different pubs.
    expect(namesLikelySamePub("bell", "bell and crown")).toBe(false);
    expect(namesLikelySamePub("crown", "crown and anchor")).toBe(false);
  });
});

describe("canonicalizeDataset — coordinate-drift + matching-ish name dedupe", () => {
  // The exact repro coverage-lane filed: an existing canonical priced venue and
  // an imported seed of the SAME pub whose coords drift ~56 m and round to a
  // different 4-dp key, slipping past a rounded-coord dedup and doubling the pin.
  const MOON_CANONICAL = makeRow({
    app_price_id: "app_price_moon_canon",
    pub_name: "The Moon on the Hill - JD Wetherspoon",
    price_gbp: 2.49,
    address: "373-375 Station Rd, Harrow HA1 2AW, UK",
    latitude: 51.5794,
    longitude: -0.3342,
    primary_borough: "Harrow",
    source_datasets: "canonical_borough_leaderboard_enriched|individual_pub_page",
  });
  const MOON_SEED = makeRow({
    app_price_id: "app_price_moon_seed",
    pub_name: "The Moon on the Hill",
    price_gbp: null,
    address: "Harrow, Greater London",
    latitude: 51.5795,
    longitude: -0.335,
    primary_borough: "Harrow",
    source_datasets: "outer_london_osm",
  });

  it("collapses the Moon on the Hill drift-duplicate into ONE venue", () => {
    const seedId = stableVenueIdFromKey(venueGroupingKey(MOON_SEED));
    const canonId = stableVenueIdFromKey(venueGroupingKey(MOON_CANONICAL));
    expect(seedId).not.toBe(canonId); // two identities before canonicalization

    const { aliases, stats, rows } = canonicalizeDataset([MOON_CANONICAL, MOON_SEED]);
    expect(stats.duplicateClusters).toBe(1);
    expect(stats.mergedRecords).toBe(1);
    expect(stats.venueIdentitiesAfter).toBe(1);
    // The clean, operator-suffix-free name wins as canonical (rule #1: never
    // surface "- JD Wetherspoon" as the pub name), so the suffixed record folds
    // onto the seed's clean identity — one venue either way.
    expect(aliases).toEqual({ [canonId]: seedId });
    expect(rows.every((r) => r.pub_name === "The Moon on the Hill")).toBe(true);
    // Both price rows survive untouched — the £2.49 canonical price is never lost
    // just because the unpriced seed row supplied the winning name.
    expect(rows.map((r) => r.price_gbp).sort()).toEqual([2.49, null]);
  });

  it("merges a matching-ish name a few doors along (Kings Head ↔ Kings Head Tavern)", () => {
    const a = makeRow({
      pub_name: "The Kings Head",
      address: "1 Market Pl, Kingston upon Thames",
      latitude: 51.4105,
      longitude: -0.3005,
      price_gbp: 4.8,
    });
    const b = makeRow({
      pub_name: "Kings Head Tavern",
      address: "Kingston upon Thames, Greater London",
      latitude: 51.41053,
      longitude: -0.30045,
      price_gbp: null,
      source_datasets: "outer_london_osm",
    });
    const { stats } = canonicalizeDataset([a, b]);
    expect(stats.duplicateClusters).toBe(1);
    expect(stats.mergedRecords).toBe(1);
  });

  it("does NOT fuzzy-merge a matching-ish name that is FAR apart", () => {
    // Same names as above but ~1 km apart — beyond the tight fuzzy radius.
    const a = makeRow({ pub_name: "The Kings Head", latitude: 51.41, longitude: -0.3, price_gbp: 4.8 });
    const b = makeRow({ pub_name: "Kings Head Tavern", latitude: 51.419, longitude: -0.3, price_gbp: null });
    const { stats } = canonicalizeDataset([a, b]);
    expect(stats.duplicateClusters).toBe(0);
  });

  it("does NOT fuzzy-merge two distinct nearby pubs sharing one generic-stripped token", () => {
    // "The Bell" and "The Bell and Crown" 20 m apart are different pubs.
    const bell = makeRow({ pub_name: "The Bell", latitude: 51.5, longitude: -0.1, price_gbp: 5 });
    const bellCrown = makeRow({
      pub_name: "The Bell and Crown",
      latitude: 51.50018,
      longitude: -0.1,
      price_gbp: 5,
    });
    const { stats } = canonicalizeDataset([bell, bellCrown]);
    expect(stats.duplicateClusters).toBe(0);
  });

  it("does NOT fuzzy-bridge two conflicting postcodes via a matching-ish name", () => {
    // Near-name, ~20 m apart, but N16 vs W1D — genuinely distinct pubs.
    const a = makeRow({
      pub_name: "Kings Head",
      address: "1 High St, London N16 0NY",
      latitude: 51.5,
      longitude: -0.1,
      price_gbp: 4,
    });
    const b = makeRow({
      pub_name: "Kings Head Tavern",
      address: "1 High St, London W1D 5DH",
      latitude: 51.50018,
      longitude: -0.1,
      price_gbp: null,
    });
    const aId = stableVenueIdFromKey(venueGroupingKey(a));
    const bId = stableVenueIdFromKey(venueGroupingKey(b));
    const { aliases } = canonicalizeDataset([a, b]);
    const resolve = (id: string) => aliases[id] ?? id;
    expect(resolve(aId)).not.toBe(resolve(bId));
  });

  it("re-running fuzzy canonicalization on its own output is a no-op", () => {
    const first = canonicalizeDataset([MOON_CANONICAL, MOON_SEED]);
    expect(first.stats.duplicateClusters).toBe(1);
    const second = canonicalizeDataset(first.rows);
    expect(second.stats.duplicateClusters).toBe(0);
    expect(second.aliases).toEqual({});
    expect(second.rows).toEqual(first.rows);
  });
});

describe("mergeAliasMaps — alias-prune with cycle detection", () => {
  it("carries forward a prior alias untouched by this run", () => {
    expect(mergeAliasMaps({ x: "y" }, { a: "b" })).toEqual({ x: "y", a: "b" });
  });

  it("rebases a prior alias through this run's new winner (multi-hop chain)", () => {
    // Prior run recorded b -> a; this run separately merges a -> c (a new,
    // richer record won). "b" must resolve through to the CURRENT canonical
    // id "c", not the now-stale "a".
    const merged = mergeAliasMaps({ b: "a" }, { a: "c" });
    expect(merged).toEqual({ a: "c", b: "c" });
  });

  it("drops a mapping that rebases into a cycle rather than persist it", () => {
    // Prior: a -> b. This run: b -> a (canonical choice flipped). Naively
    // spreading both maps would leave a live cycle (a -> b -> a); the prior
    // mapping must be dropped instead of poisoning alias resolution.
    const merged = mergeAliasMaps({ a: "b" }, { b: "a" });
    expect(merged).toEqual({ b: "a" });
  });

  it("this run's mapping always wins over a conflicting prior mapping for the same id", () => {
    const merged = mergeAliasMaps({ x: "stale" }, { x: "fresh" });
    expect(merged).toEqual({ x: "fresh" });
  });

  it("drops a pre-existing historical cycle carried in the prior map alone", () => {
    // A 2-cycle living entirely in the prior map, untouched by this run. The
    // traversal must follow the prior map too, or the cycle survives unnoticed.
    expect(mergeAliasMaps({ a: "b", b: "a" }, {})).toEqual({});
  });

  it("drops a longer historical cycle carried in the prior map alone", () => {
    expect(mergeAliasMaps({ a: "b", b: "c", c: "a" }, {})).toEqual({});
  });

  it("flattens a prior-only chain to its terminal id (single-hop resolve)", () => {
    // b -> a -> c in history; both must resolve straight to terminal c so a
    // single-hop lookup (lib/venueAliases.ts) never lands on a non-terminal id.
    expect(mergeAliasMaps({ b: "a", a: "c" }, {})).toEqual({ b: "c", a: "c" });
  });
});

// scripts/lib/venueCanonicalization.mjs's venueGroupingKey/stableVenueIdFromKey
// are a manually-mirrored copy of lib/venues.ts's (plain-Node scripts can't
// import the .ts runtime module). If the two implementations ever drift —
// e.g. a new field folded into one side's key but not the other's —
// canonicalization/validate-data would silently pass while runtime grouping
// computes a DIFFERENT venue identity, defeating the whole guarantee without
// erroring anywhere. This test fuzzes both implementations across varied
// inputs (including edge cases: mixed case, extra whitespace, unicode,
// boundary coordinates) and fails the moment they disagree, so a future
// one-sided edit is caught here instead of shipping silently.
describe("venueGroupingKey / stableVenueIdFromKey — parity with lib/venues.ts", () => {
  const cases: Array<Partial<VenuePrice>> = [
    {},
    { pub_name: "  The   ROCHESTER Castle  ", address: "12 High St" },
    { pub_name: "café münchen", address: "Straße 1, München" },
    { pub_name: "The Crown", latitude: 0, longitude: 0 },
    { pub_name: "The Crown", latitude: -51.5, longitude: 179.999999 },
    { pub_name: "", address: "" },
    { pub_name: "UPPER-Case-Pub", address: "Tab\tSeparated\nAddress" },
    { latitude: 51.500001, longitude: -0.099999 },
    { latitude: 51.5000049, longitude: -0.0999949 }, // rounds differently at 5dp boundary
  ];

  it.each(cases)("matches for row %#", (overrides) => {
    const row = makeRow(overrides);

    const scriptsKey = venueGroupingKey(row);
    const libKey = tsVenueGroupingKey(row);
    expect(scriptsKey).toBe(libKey);

    const scriptsId = stableVenueIdFromKey(scriptsKey);
    const libId = tsStableVenueIdFromKey(libKey);
    expect(scriptsId).toBe(libId);
  });
});
