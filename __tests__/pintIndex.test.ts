import { describe, expect, it } from "vitest";

import {
  boroughCode,
  buildLeagueTable,
  indexSummary,
  leagueTableToCsv,
  LEAGUE_CSV_HEADER,
  validatePintIndexSnapshot,
  type PintIndexSnapshot,
} from "@/lib/pintIndex";
import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";

const snapshot = (over: Partial<PintIndexSnapshot> = {}): PintIndexSnapshot => ({
  schemaVersion: 1,
  snapshotId: "test-v1",
  status: "published",
  generatedAt: "2026-07-16T12:00:00.000Z",
  observationWindow: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-15T23:59:59.000Z" },
  classification: { version: LONDON_BOROUGH_CLASSIFIER_VERSION, method: "point_in_polygon", sourceArtifact: "data/london_boroughs_simplified.json", licence: "OGL v3" },
  sources: [{
    id: "community-1",
    kind: "confirmed_pint_drop",
    publisher: "PUBMAXX contributor",
    sourceUrl: "https://pubmaxxing.com/evidence/1",
    licence: null,
    confirmationId: "drop-confirmation-1",
    reviewState: "confirmed",
  }],
  observations: [
    { venueId: "a", pubName: "Cheap A", boroughCode: "hackney", boroughName: "Hackney", pricePence: 500, observedAt: "2026-07-10T12:00:00.000Z", sourceId: "community-1" },
    { venueId: "b", pubName: "Cheap B", boroughCode: "hackney", boroughName: "Hackney", pricePence: 600, observedAt: "2026-07-11T12:00:00.000Z", sourceId: "community-1" },
    { venueId: "c", pubName: "Posh", boroughCode: "westminster", boroughName: "Westminster", pricePence: 850, observedAt: "2026-07-12T12:00:00.000Z", sourceId: "community-1" },
  ],
  excluded: [],
  ...over,
});

describe("public Pint Index snapshot", () => {
  it("validates explicit provenance and canonical boroughs", () => {
    expect(validatePintIndexSnapshot(snapshot()).ok).toBe(true);
    expect(boroughCode("Kensington and Chelsea")).toBe("kensington-and-chelsea");
  });

  it("rejects competitor sources and invented borough labels", () => {
    const bad = snapshot({
      sources: [{ id: "x", kind: "competitor", publisher: "Aggregator", sourceUrl: "https://example.com", licence: null } as unknown as PintIndexSnapshot["sources"][number]],
      observations: [{ venueId: "x", pubName: "X", boroughCode: "soho", boroughName: "Soho" as never, pricePence: 500, observedAt: "2026-07-10", sourceId: "x" }],
    });
    const result = validatePintIndexSnapshot(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/eligible|canonical/i);
  });

  it("rejects community drink-lens prices as Pint Index evidence", () => {
    const nonPint = snapshot({
      sources: [{
        id: "soft-1",
        kind: "community_price",
        publisher: "PUBMAXX contributor",
        sourceUrl: "https://pubmaxxing.com/map",
        licence: null,
      } as unknown as PintIndexSnapshot["sources"][number]],
      observations: [{
        venueId: "a",
        pubName: "Cheap A",
        boroughCode: "hackney",
        boroughName: "Hackney",
        pricePence: 320,
        observedAt: "2026-07-10T12:00:00.000Z",
        sourceId: "soft-1",
      }],
    });
    const result = validatePintIndexSnapshot(nonPint);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/eligible/i);

    const whisky = snapshot({
      sources: [{
        id: "whisky-1",
        kind: "community_price",
        publisher: "PUBMAXX contributor",
        sourceUrl: "https://pubmaxxing.com/map?drink=whisky",
        licence: null,
      } as unknown as PintIndexSnapshot["sources"][number]],
      observations: [{
        venueId: "a",
        pubName: "Cheap A",
        boroughCode: "hackney",
        boroughName: "Hackney",
        pricePence: 600,
        observedAt: "2026-07-10T12:00:00.000Z",
        sourceId: "whisky-1",
      }],
    });
    expect(validatePintIndexSnapshot(whisky).ok).toBe(false);
  });

  it("rejects snapshots produced by a non-canonical borough classifier", () => {
    expect(validatePintIndexSnapshot(snapshot({
      classification: {
        ...snapshot().classification,
        version: "legacy-borough-classifier",
      },
    })).ok).toBe(false);
  });

  it("rejects unconfirmed drops and unofficial first-party labels", () => {
    const unconfirmed = snapshot({
      sources: [{
        id: "community-1",
        kind: "confirmed_pint_drop",
        publisher: "PUBMAXX contributor",
        sourceUrl: "https://pubmaxxing.com/evidence/1",
        licence: null,
        confirmationId: "",
        reviewState: "confirmed",
      }],
    });
    expect(validatePintIndexSnapshot(unconfirmed).ok).toBe(false);

    const unofficial = snapshot({
      sources: [{
        id: "community-1",
        kind: "official_publisher",
        publisher: "Example Pub",
        publisherType: "pub",
        officialDomain: "examplepub.co.uk",
        sourceUrl: "https://aggregator.example/example-pub",
        licence: null,
      }],
    });
    expect(validatePintIndexSnapshot(unofficial).ok).toBe(false);
  });

  it("uses the newest eligible observation per venue", () => {
    const input = snapshot({ observations: [
      ...snapshot().observations,
      { venueId: "a", pubName: "Cheap A", boroughCode: "hackney", boroughName: "Hackney", pricePence: 550, observedAt: "2026-07-14T12:00:00.000Z", sourceId: "community-1" },
    ] });
    const rows = buildLeagueTable(input);
    expect(rows.map((row) => row.name)).toEqual(["Hackney", "Westminster"]);
    expect(rows[0]).toMatchObject({ pubCount: 2, averageGbp: 5.75, minGbp: 5.5, maxGbp: 6 });
    expect(indexSummary(rows)).toMatchObject({ boroughCount: 2, pubCount: 3, averageGbp: 6.67 });
  });

  it("emits provenance-aware CSV and an honest header-only empty snapshot", () => {
    const csv = leagueTableToCsv(snapshot());
    expect(csv.split("\r\n")[0]).toBe(LEAGUE_CSV_HEADER.join(","));
    expect(csv).toContain("2026-07-01T00:00:00.000Z");
    expect(csv).toContain("test-v1");
    const empty = snapshot({ status: "empty", observationWindow: null, sources: [], observations: [] });
    expect(leagueTableToCsv(empty)).toBe(`${LEAGUE_CSV_HEADER.join(",")}\r\n`);
  });
});
