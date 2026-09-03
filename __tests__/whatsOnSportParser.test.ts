import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSportAttributeRows,
  gkVenueIdFromRecord,
  parseGreeneKingSportsFlag,
  pubPageUrlFromMenuUrl,
  sportAttributeRow,
} from "../scripts/whatson/greeneKingSportParser.mjs";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", "whats_on", name), "utf8");

// Real trimmed excerpts fetched 2026-07-11 (see the comment atop each file).
const YES = fixture("greene-king-sport-yes.html"); // Arkles, sports:true
const NO = fixture("greene-king-sport-no.html"); // Turf Tavern, sports:false

// Real menu.json identities (data/greene_king/raw/*.menu.json).
const ARKLES = {
  name: "Arkles",
  menuUrl: "https://www.greeneking.co.uk/pubs/merseyside/arkles/menu",
  address: "Liverpool",
  lat: 53.4303544,
  lng: -2.9574746,
};
const PROSPECT = {
  name: "Prospect of Whitby",
  menuUrl: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
  address: "London",
  lat: null,
  lng: null,
};

describe("parseGreeneKingSportsFlag", () => {
  it("reads the first-party true/false flag from a real pub page", () => {
    expect(parseGreeneKingSportsFlag(YES)).toBe(true);
    expect(parseGreeneKingSportsFlag(NO)).toBe(false);
  });

  it("returns null when the flag is absent instead of guessing", () => {
    expect(parseGreeneKingSportsFlag("<html></html>")).toBeNull();
    expect(parseGreeneKingSportsFlag("")).toBeNull();
  });

  it("ignores the look-alike sports_flag string and reads only the boolean", () => {
    // A page whose only 'sports' token is the analytics string must not match.
    expect(parseGreeneKingSportsFlag("<script>'sports_flag' : 'true'</script>")).toBeNull();
  });

  it("refuses to guess when a page carries conflicting flags", () => {
    expect(parseGreeneKingSportsFlag('{"sports":true} ... {"sports":false}')).toBeNull();
  });
});

describe("url + venueId helpers", () => {
  it("derives the pub page url from the menu url", () => {
    expect(pubPageUrlFromMenuUrl(ARKLES.menuUrl)).toBe(
      "https://www.greeneking.co.uk/pubs/merseyside/arkles",
    );
  });

  it("derives a deterministic venueId from the shared venue-key functions", () => {
    expect(gkVenueIdFromRecord(ARKLES)).toBe(gkVenueIdFromRecord({ ...ARKLES }));
    expect(gkVenueIdFromRecord(ARKLES)).toMatch(/^venue-/);
  });

  it("returns null venueId when coordinates are missing (never synthesised)", () => {
    expect(gkVenueIdFromRecord(PROSPECT)).toBeNull();
  });
});

describe("sportAttributeRow", () => {
  const observedAt = "2026-07-11T00:00:00.000Z";

  it("builds a B1-contract attribute row with NO startsAt", () => {
    const row = sportAttributeRow(ARKLES, observedAt);
    expect(row).toMatchObject({
      id: "sport-attr-gk-arkles",
      placeName: "Arkles",
      lat: 53.4303544,
      lng: -2.9574746,
      kind: "sport",
      title: "Shows live sport",
      source: {
        label: "Greene King",
        url: "https://www.greeneking.co.uk/pubs/merseyside/arkles",
      },
      observedAt,
      confidence: "listed",
    });
    expect(row.venueId).toMatch(/^venue-/);
    expect(row.detail).toContain("partner-gated");
    expect(row).not.toHaveProperty("startsAt");
  });

  it("omits venueId / lat / lng when the record lacks coordinates", () => {
    const row = sportAttributeRow(PROSPECT, observedAt);
    expect(row).not.toHaveProperty("venueId");
    expect(row).not.toHaveProperty("lat");
    expect(row).not.toHaveProperty("lng");
    expect(row.id).toBe("sport-attr-gk-prospect-of-whitby");
  });
});

describe("buildSportAttributeRows", () => {
  const observedAt = "2026-07-11T00:00:00.000Z";

  it("emits rows only for pubs flagged true and counts the rest", () => {
    const venues = [
      { record: ARKLES, showsSport: parseGreeneKingSportsFlag(YES) },
      {
        record: {
          ...ARKLES,
          name: "Turf Tavern",
          menuUrl: "https://www.greeneking.co.uk/pubs/oxfordshire/turf-tavern/menu",
        },
        showsSport: parseGreeneKingSportsFlag(NO),
      },
      { record: PROSPECT, showsSport: null },
    ];
    const { rows, counts } = buildSportAttributeRows({ venues, observedAt });
    expect(counts).toEqual({ pubsChecked: 3, showsLiveSport: 1, noLiveSport: 1, undetermined: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("sport-attr-gk-arkles");
  });

  it("every emitted row carries first-party source + observedAt provenance", () => {
    const venues = [{ record: ARKLES, showsSport: true }];
    const { rows } = buildSportAttributeRows({ venues, observedAt });
    for (const row of rows) {
      expect(row.kind).toBe("sport");
      expect(row.source.label).toBe("Greene King");
      expect(row.source.url).toMatch(/^https:\/\/www\.greeneking\.co\.uk\/pubs\//);
      expect(row.observedAt).toBe(observedAt);
      expect(row.confidence).toBe("listed");
      expect(row).not.toHaveProperty("startsAt");
    }
  });
});
