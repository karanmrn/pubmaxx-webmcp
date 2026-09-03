import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// prettier-ignore
import {
  LONDON_OPEN_PUBS_AUTHORITIES,
  OPEN_PUBS_MATCH_RADIUS_M,
  OPEN_PUBS_SAMPLE_UNMATCHED_CAP,
  buildIdentityIndex,
  buildLondonCuratedMatchReport,
  classifyOpenPubMatch,
  evaluateOpenPubsMatches,
  filterOpenPubsRowsForLondon,
  identityFromOsmPub,
  identityFromSlimVenue,
  isLondonOpenPubsAuthority,
  matchOpenPubToIdentity,
  normalizeOpenPubsCells,
  parseOpenPubsCsv,
  parseCsvNull,
  // @ts-expect-error -- untyped .mjs module (resolves fine at runtime under vitest)
} from "../scripts/lib/openPubs.mjs";

const FIXTURE = readFileSync(
  join(__dirname, "fixtures/open_pubs_sample.csv"),
  "utf8",
);

const CURATED = [
  {
    id: "venue-xjf3n0",
    name: "Arnos Arms",
    lat: 51.6162,
    lng: -0.132117,
    layer: "curated" as const,
  },
  {
    id: "venue-1p5ftm3",
    name: "The Dove",
    lat: 51.4905,
    lng: -0.234857,
    layer: "curated" as const,
  },
  {
    id: "venue-16pnwmm",
    name: "Prospect of Whitby",
    lat: 51.5071,
    lng: -0.0511255,
    layer: "curated" as const,
  },
  {
    id: "venue-alrti6",
    name: "Ye Olde Cheshire Cheese",
    lat: 51.51442896,
    lng: -0.107211023,
    layer: "curated" as const,
  },
];

describe("parseOpenPubsCsv", () => {
  it("parses the headerless fixture into normalised rows", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      fsaId: 206633,
      name: "The Arnos Arms",
      postcode: "N11 1AN",
      localAuthority: "Enfield",
    });
    expect(rows[0].lat).toBeCloseTo(51.61624, 5);
    expect(rows[4].name).toBe("Unmatched Test Arms");
    expect(rows[5].lat).toBeNull();
    expect(rows[5].lng).toBeNull();
  });

  it("skips a leading fsa_id header row when present", () => {
    const withHeader = `fsa_id,name,address,postcode,easting,northing,latitude,longitude,local_authority\n${FIXTURE}`;
    expect(parseOpenPubsCsv(withHeader)).toHaveLength(6);
  });

  it("treats MySQL-style \\N as null", () => {
    expect(parseCsvNull("\\N")).toBeNull();
    expect(normalizeOpenPubsCells(["1", "Pub", "Addr", "E1 1AA", "0", "0", "\\N", "\\N", "X"])).toMatchObject({
      lat: null,
      lng: null,
    });
  });
});

describe("matchOpenPubToIdentity", () => {
  it("matches known London rows to curated identity within the radius gate", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const index = buildIdentityIndex(CURATED);

    const arnos = matchOpenPubToIdentity(rows[0], index);
    expect(arnos).toMatchObject({
      id: "venue-xjf3n0",
      layer: "curated",
      matchType: "exact-name-distance",
    });
    expect(arnos.distanceM).toBeLessThanOrEqual(OPEN_PUBS_MATCH_RADIUS_M);

    const dove = matchOpenPubToIdentity(rows[1], index);
    expect(dove?.id).toBe("venue-1p5ftm3");

    const whitby = matchOpenPubToIdentity(rows[2], index);
    expect(whitby?.id).toBe("venue-16pnwmm");
    expect(whitby?.distanceM).toBeLessThan(30);

    const cheese = matchOpenPubToIdentity(rows[3], index);
    expect(cheese?.id).toBe("venue-alrti6");
  });

  it("refuses a far-away same-shape name and rows without coordinates", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const index = buildIdentityIndex(CURATED);
    expect(matchOpenPubToIdentity(rows[4], index)).toBeNull();
    expect(matchOpenPubToIdentity(rows[5], index)).toBeNull();
  });

  it("prefers curated over OSM when both sit on the same pub", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const osmTwin = identityFromOsmPub({
      osmId: "node/1",
      name: "Prospect of Whitby",
      lat: 51.5072,
      lng: -0.05107,
    });
    expect(osmTwin?.id).toBe("venue-uk-n1");
    const index = buildIdentityIndex([...CURATED, osmTwin]);
    const match = matchOpenPubToIdentity(rows[2], index);
    expect(match?.layer).toBe("curated");
    expect(match?.id).toBe("venue-16pnwmm");
  });

  it("refuses ambiguous curated ties when refuseAmbiguous is set", () => {
    const row = {
      fsaId: 1,
      name: "The Crown",
      address: "1 High Street",
      postcode: "E1 1AA",
      easting: null,
      northing: null,
      lat: 51.515,
      lng: -0.07,
      localAuthority: "Tower Hamlets",
    };
    const twins = [
      {
        id: "venue-crown-a",
        name: "Crown",
        lat: 51.51501,
        lng: -0.07005,
        layer: "curated" as const,
      },
      {
        id: "venue-crown-b",
        name: "The Crown",
        lat: 51.51502,
        lng: -0.07008,
        layer: "curated" as const,
      },
    ];
    const index = buildIdentityIndex(twins);
    expect(matchOpenPubToIdentity(row, index)?.id).toBeTruthy();
    expect(matchOpenPubToIdentity(row, index, { refuseAmbiguous: true })).toBeNull();
    expect(classifyOpenPubMatch(row, index).status).toBe("ambiguous");
  });
});

describe("evaluateOpenPubsMatches", () => {
  it("reports match rates without inventing prices or mutating inputs", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const frozen = structuredClone(rows);
    const summary = evaluateOpenPubsMatches(rows, CURATED);

    expect(summary.rowsRead).toBe(6);
    expect(summary.withCoords).toBe(5);
    expect(summary.skippedNoCoords).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.matchedCurated).toBe(4);
    expect(summary.matchedOsm).toBe(0);
    expect(summary.unmatched).toBe(1);
    expect(summary.ambiguous).toBe(0);
    expect(summary.totals).toEqual({
      matched: 4,
      unmatched: 1,
      ambiguous: 0,
      skipped: 1,
    });
    expect(summary.sampleUnmatchedNames).toEqual(["Unmatched Test Arms"]);
    expect(summary.matchRateOfCoordsPct).toBe(80);
    expect(rows).toEqual(frozen);
    // No price field anywhere in the evaluation contract.
    expect(JSON.stringify(summary)).not.toMatch(/price/i);
  });

  it("maps slim venue helpers into curated identity candidates", () => {
    const c = identityFromSlimVenue({
      id: "venue-x",
      name: "Test Arms",
      lat: 51.5,
      lng: -0.1,
      filterHints: { searchText: "test arms e1" },
    });
    expect(c).toEqual({
      id: "venue-x",
      name: "Test Arms",
      lat: 51.5,
      lng: -0.1,
      address: "test arms e1",
      layer: "curated",
    });
    expect(identityFromSlimVenue({ id: 1, name: "x", lat: 1, lng: 2 })).toBeNull();
  });

  it("counts ambiguous ties separately from unmatched", () => {
    const rows = [
      {
        fsaId: 42,
        name: "The Crown",
        address: "1 High Street",
        postcode: "E1 1AA",
        easting: null,
        northing: null,
        lat: 51.515,
        lng: -0.07,
        localAuthority: "Tower Hamlets",
      },
    ];
    const twins = [
      {
        id: "venue-crown-a",
        name: "Crown",
        lat: 51.51501,
        lng: -0.07005,
        layer: "curated" as const,
      },
      {
        id: "venue-crown-b",
        name: "The Crown",
        lat: 51.51502,
        lng: -0.07008,
        layer: "curated" as const,
      },
    ];
    const summary = evaluateOpenPubsMatches(rows, twins);
    expect(summary.matched).toBe(0);
    expect(summary.unmatched).toBe(0);
    expect(summary.ambiguous).toBe(1);
    expect(summary.totals.ambiguous).toBe(1);
    expect(summary.ambiguousRows[0]?.candidates).toHaveLength(2);
  });
});

describe("London curated identity report", () => {
  it("keeps the 33 Greater London authority labels", () => {
    expect(LONDON_OPEN_PUBS_AUTHORITIES).toHaveLength(33);
    expect(isLondonOpenPubsAuthority("Tower Hamlets")).toBe(true);
    expect(isLondonOpenPubsAuthority("city of london")).toBe(true);
    expect(isLondonOpenPubsAuthority("Nowhere")).toBe(false);
  });

  it("filters the fixture to London authorities only", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const london = filterOpenPubsRowsForLondon(rows);
    expect(london).toHaveLength(5);
    expect(london.every((r: { localAuthority: string }) => isLondonOpenPubsAuthority(r.localAuthority))).toBe(true);
    expect(london.map((r: { name: string }) => r.name)).not.toContain("Unmatched Test Arms");
  });

  it("builds a dry-run JSON report with totals and capped unmatched names", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const report = buildLondonCuratedMatchReport(rows, CURATED, {
      csvPath: "fixture.csv",
    });

    expect(report.dryRun).toBe(true);
    expect(report.mergedIntoSlim).toBe(false);
    expect(report.inventedPrices).toBe(false);
    expect(report.scope).toBe("london-curated");
    expect(report.identity).toBe("curated");
    expect(report.city).toBe("london");
    expect(report.csvPath).toBe("fixture.csv");
    // Nowhere-authority unmatched row is filtered out; remaining London miss is
    // the no-coords skip, so unmatched stays 0 and skipped is 1.
    expect(report.totals).toEqual({
      matched: 4,
      unmatched: 0,
      ambiguous: 0,
      skipped: 1,
    });
    expect(report.sampleUnmatchedNames).toEqual([]);
    expect(report.stats.londonRows).toBe(5);
    expect(report.stats.identityCandidates).toBe(4);
    // inventedPrices is the refusal flag; no observation price figures ride along.
    expect(report.inventedPrices).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/"cheapestPrice"|"pricePence"|"latestDemoPrice"/i);
  });

  it("caps sample unmatched names and never merges slim", () => {
    const unmatchedRows = Array.from({ length: 25 }, (_, i) => ({
      fsaId: 1000 + i,
      name: `Lonely Arms ${i}`,
      address: "1 Nowhere Street, London",
      postcode: "E1 1AA",
      easting: null,
      northing: null,
      lat: 51.5 + i * 0.001,
      lng: -0.05,
      localAuthority: "Tower Hamlets",
    }));
    const report = buildLondonCuratedMatchReport(unmatchedRows, CURATED);
    expect(report.totals.unmatched).toBe(25);
    expect(report.totals.matched).toBe(0);
    expect(report.sampleUnmatchedNames).toHaveLength(OPEN_PUBS_SAMPLE_UNMATCHED_CAP);
    expect(report.sampleUnmatchedNames[0]).toBe("Lonely Arms 0");
    expect(report.mergedIntoSlim).toBe(false);
  });
});
