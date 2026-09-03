import { describe, expect, it } from "vitest";

import {
  OUT_VENUE_MATCH_PROXIMITY_METERS,
  attachOutVenues,
  buildOutVenueMatchIndex,
  isOutVenueId,
  matchOutRowVenue,
} from "@/lib/out/venueMatch";
import type { VenueRef } from "@/lib/venueIndex";
import type { WhatsOnRow } from "@/lib/whatsOn";

// The request-time matcher over the slim venue index. It is the SAME matcher
// the build-time refresh runs (scripts/whatson/resolveVenueId.mjs), fed an
// index built from the slim rows the server already holds. A normalised-name
// match resolves only when exactly one candidate is proximity-confirmed within
// 75 m; zero or several confirmed candidates resolve to nothing.

const LEXINGTON: VenueRef = {
  id: "venue-1137z1c",
  name: "The Lexington",
  borough: "Islington",
  lat: 51.5326,
  lng: -0.1119,
};

const DUBLIN_CASTLE: VenueRef = {
  id: "venue-1d1tez",
  name: "The Dublin Castle",
  borough: "Camden",
  lat: 51.5397,
  lng: -0.1429,
};

// Two same-name Windmills: the slim index carries no address, so proximity
// alone must not choose between identities with the same name.
const WINDMILL_BRIXTON: VenueRef = {
  id: "venue-pmqf8u",
  name: "The Windmill",
  borough: "Lambeth",
  lat: 51.4553,
  lng: -0.1215,
};
const WINDMILL_SOHO: VenueRef = {
  id: "venue-lm7rmo",
  name: "The Windmill",
  borough: "Westminster",
  lat: 51.5127,
  lng: -0.1367,
};

function liveRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "events-tm-live-1",
    placeName: "The Lexington",
    kind: "music",
    startsAt: "2026-08-16T19:30:00.000Z",
    title: "Live band night",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    sourceId: "tm-1",
    lat: 51.5326,
    lng: -0.1119,
    ...overrides,
  };
}

const index = buildOutVenueMatchIndex([LEXINGTON, DUBLIN_CASTLE, WINDMILL_BRIXTON, WINDMILL_SOHO]);

describe("matchOutRowVenue", () => {
  it("lands a live row with a listed name and coordinates on its pin", () => {
    expect(matchOutRowVenue(liveRow(), index)).toBe("venue-1137z1c");
  });

  it("ignores the article and case, the way the refresh matcher does", () => {
    expect(matchOutRowVenue(liveRow({ placeName: "LEXINGTON" }), index)).toBe("venue-1137z1c");
    expect(matchOutRowVenue(liveRow({ placeName: "the Dublin Castle", lat: 51.5397, lng: -0.1429 }), index)).toBe(
      "venue-1d1tez",
    );
  });

  it("refuses a name match whose coordinates sit past the proximity floor", () => {
    // About 1.1 km north of the pub: a different Lexington, or a bad geocode.
    expect(matchOutRowVenue(liveRow({ lat: 51.5426 }), index)).toBeNull();
    expect(OUT_VENUE_MATCH_PROXIMITY_METERS).toBe(75);
  });

  it("refuses a row that carries no coordinates, because a bare name is a guess", () => {
    expect(matchOutRowVenue(liveRow({ lat: undefined, lng: undefined }), index)).toBeNull();
  });

  it("refuses every same-name collision even when one candidate is nearby", () => {
    expect(
      matchOutRowVenue(liveRow({ placeName: "The Windmill", lat: 51.4553, lng: -0.1215 }), index),
    ).toBeNull();
    expect(
      matchOutRowVenue(liveRow({ placeName: "The Windmill", lat: 51.5, lng: -0.13 }), index),
    ).toBeNull();
  });

  it("answers nothing for a place the index does not hold", () => {
    expect(matchOutRowVenue(liveRow({ placeName: "The O2", lat: 51.503, lng: 0.0032 }), index)).toBeNull();
  });
});

describe("attachOutVenues", () => {
  it("attaches a venue to every matchable row and counts what stayed unmatched", () => {
    const matched = liveRow();
    const arena = liveRow({ id: "events-tm-o2", placeName: "The O2", lat: 51.503, lng: 0.0032 });
    const result = attachOutVenues([matched, arena], index);
    expect(result.rows[0].venueId).toBe("venue-1137z1c");
    expect(result.rows[1].venueId).toBeUndefined();
    expect(result.matchedAtRequest).toBe(1);
    expect(result.unmatched).toBe(1);
  });

  it("leaves a row the refresh already matched alone", () => {
    const bundled = liveRow({ venueId: "venue-from-refresh", placeName: "The Dublin Castle" });
    const result = attachOutVenues([bundled], index);
    expect(result.rows[0].venueId).toBe("venue-from-refresh");
    expect(result.matchedAtRequest).toBe(0);
    expect(result.unmatched).toBe(0);
  });

  it("reattaches a row whose venueId is only whitespace", () => {
    const result = attachOutVenues([liveRow({ venueId: "  " })], index);
    expect(result.rows[0].venueId).toBe("venue-1137z1c");
    expect(result.matchedAtRequest).toBe(1);
    expect(result.unmatched).toBe(0);
  });

  it("does not mutate the rows it was handed", () => {
    const row = liveRow();
    attachOutVenues([row], index);
    expect(row.venueId).toBeUndefined();
  });
});

describe("isOutVenueId", () => {
  it("uses precomputed membership instead of rescanning matcher buckets per row", () => {
    expect(index.venueIds).toEqual(
      new Set([
        LEXINGTON.id,
        DUBLIN_CASTLE.id,
        WINDMILL_BRIXTON.id,
        WINDMILL_SOHO.id,
      ]),
    );

    const rejectBucketScan = <K, V>(map: Map<K, V>): Map<K, V> =>
      new Proxy(map, {
        get(target, property) {
          if (property === "values") throw new Error("matcher bucket scan");
          return Reflect.get(target, property, target);
        },
      });
    const guardedIndex = {
      ...index,
      exactByKey: rejectBucketScan(index.exactByKey),
      byNormalizedName: rejectBucketScan(index.byNormalizedName),
    };

    expect(isOutVenueId(guardedIndex, ` ${LEXINGTON.id} `)).toBe(true);
    expect(isOutVenueId(guardedIndex, "venue-missing")).toBe(false);
  });
});
