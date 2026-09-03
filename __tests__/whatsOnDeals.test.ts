import { describe, expect, it } from "vitest";

import {
  buildWetherspoonsDealRows,
  filterGreaterLondonWetherspoons,
  londonWallClockToIso,
  WETHERSPOONS_DEALS,
  WETHERSPOONS_FOOD_DRINK_SOURCE,
} from "../scripts/whatson/dealsRefresh.mjs";
import { dedupeKey, dedupeRows, isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";

const CORONET = {
  slug: "the-coronet-holloway",
  name: "The Coronet",
  postcode: "N7 6QA",
  latitude: 51.5548,
  longitude: -0.1132,
};

const BROADWAY = {
  slug: "the-broadway-catford",
  name: "The Broadway",
  postcode: "SE6 4SP",
  latitude: 51.4452,
  longitude: -0.0209,
};

// A real Wetherspoons pub well outside Greater London (Abingdon-on-Thames,
// Oxfordshire) — used to prove the postcode filter actually drops non-London
// venues rather than including the whole nationwide estate under a filename
// that says "london".
const OUT_OF_LONDON = {
  slug: "the-narrows-abingdon-on-thames",
  name: "The Narrows",
  postcode: "OX14 5BB",
  latitude: 51.670176,
  longitude: -1.283443,
};

describe("filterGreaterLondonWetherspoons", () => {
  it("keeps pubs whose postcode falls inside Greater London and drops the rest", () => {
    const kept = filterGreaterLondonWetherspoons([CORONET, BROADWAY, OUT_OF_LONDON]);
    expect(kept.map((p) => p.slug).sort()).toEqual(
      ["the-broadway-catford", "the-coronet-holloway"].sort(),
    );
  });

  it("drops a pub with a missing/malformed postcode rather than guessing", () => {
    const kept = filterGreaterLondonWetherspoons([{ ...CORONET, postcode: undefined }]);
    expect(kept).toHaveLength(0);
  });
});

describe("londonWallClockToIso", () => {
  it("resolves a BST (summer, +01:00) wall-clock time", () => {
    expect(londonWallClockToIso("2026-07-16", "23:00")).toBe("2026-07-16T23:00:00+01:00");
    expect(new Date(londonWallClockToIso("2026-07-16", "23:00")!).toISOString()).toBe(
      "2026-07-16T22:00:00.000Z",
    );
  });

  it("resolves a GMT (winter, +00:00) wall-clock time — DST correctness", () => {
    expect(londonWallClockToIso("2026-01-08", "23:00")).toBe("2026-01-08T23:00:00+00:00");
    expect(new Date(londonWallClockToIso("2026-01-08", "23:00")!).toISOString()).toBe(
      "2026-01-08T23:00:00.000Z",
    );
  });

  it("returns null on a malformed date or time rather than guessing", () => {
    expect(londonWallClockToIso("not-a-date", "23:00")).toBeNull();
    expect(londonWallClockToIso("2026-07-16", "25:99")).toBeNull();
    expect(londonWallClockToIso("2026-07-16", "bad")).toBeNull();
    expect(londonWallClockToIso(undefined, undefined)).toBeNull();
  });
});

describe("buildWetherspoonsDealRows", () => {
  const observedAt = "2026-07-12T00:00:00.000Z"; // a Sunday

  it("crosses every deal against every venue", () => {
    const rows = buildWetherspoonsDealRows({
      deals: WETHERSPOONS_DEALS,
      venues: [CORONET, BROADWAY],
      observedAt,
    });
    expect(rows).toHaveLength(WETHERSPOONS_DEALS.length * 2);
  });

  it("emits the B1 row contract shape with confidence:'listed', a resolved startsAt/endsAt window, and the honest caveat", () => {
    const rows = buildWetherspoonsDealRows({
      deals: [WETHERSPOONS_DEALS[0]],
      venues: [CORONET],
      observedAt,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: "deal-jdw-jdw-small-plates-monday-the-coronet-holloway",
      placeName: "The Coronet",
      lat: 51.5548,
      lng: -0.1132,
      kind: "deal",
      startsAt: "2026-07-13T11:30:00+01:00",
      endsAt: "2026-07-13T23:00:00+01:00",
      source: WETHERSPOONS_FOOD_DRINK_SOURCE,
      observedAt,
      confidence: "listed",
    });
    expect(row.title).toContain("Small Plates Club");
    expect(row.detail).toContain("£10");
    expect(row.detail).toContain("may vary per pub");
    expect(row.detail).toContain("see venue for details");
  });

  it("passes isValidWhatsOnRow (the spine's own guard)", () => {
    const rows = buildWetherspoonsDealRows({
      deals: [WETHERSPOONS_DEALS[0]],
      venues: [CORONET],
      observedAt,
    });
    const now = Date.parse("2026-07-12T12:00:00.000Z");
    expect(isValidWhatsOnRow(rows[0] as unknown, now)).toBe(true);
  });

  it("resolves a startsAt/endsAt window that lands the right side of a DST switch", () => {
    // Friday 27 Mar 2026 (GMT) — the next Monday, 30 Mar, falls AFTER the UK
    // clocks-forward switch on 29 Mar 2026, so the resolved window must carry
    // the BST (+01:00) offset even though `observedAt` itself is GMT.
    const rows = buildWetherspoonsDealRows({
      deals: [WETHERSPOONS_DEALS[0]],
      venues: [CORONET],
      observedAt: "2026-03-27T10:00:00.000Z",
    });
    expect(rows[0].startsAt).toBe("2026-03-30T11:30:00+01:00");
    expect(rows[0].endsAt).toBe("2026-03-30T23:00:00+01:00");
  });

  it("drops a venue with no slug or no name, rather than guessing an id", () => {
    const rows = buildWetherspoonsDealRows({
      deals: [WETHERSPOONS_DEALS[0]],
      venues: [{ ...CORONET, slug: undefined }, { ...CORONET, name: undefined }],
      observedAt,
    });
    expect(rows).toHaveLength(0);
  });

  it("omits lat/lng when the venue carries no usable coordinates", () => {
    const rows = buildWetherspoonsDealRows({
      deals: [WETHERSPOONS_DEALS[0]],
      venues: [{ ...CORONET, latitude: null, longitude: null }],
      observedAt,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("lat");
    expect(rows[0]).not.toHaveProperty("lng");
  });

  it("four deals x one pub produce four distinct, non-colliding rows", () => {
    const rows = buildWetherspoonsDealRows({ deals: WETHERSPOONS_DEALS, venues: [CORONET], observedAt });
    expect(rows).toHaveLength(4);
    const keys = new Set(rows.map((r) => dedupeKey(r as WhatsOnRow)));
    expect(keys.size).toBe(4);
    expect(dedupeRows(rows as WhatsOnRow[])).toHaveLength(4);
  });

  it("dedupeRows collapses two rows that land on the same (place, kind, startsAt), keeping the freshest", () => {
    const rows = buildWetherspoonsDealRows({
      deals: [WETHERSPOONS_DEALS[0]],
      venues: [CORONET],
      observedAt,
    });
    const stale = { ...rows[0], id: "stale-dupe", observedAt: "2026-07-01T00:00:00.000Z", title: "stale" };
    const fresh = { ...rows[0], id: "fresh-dupe", observedAt: "2026-07-12T00:00:00.000Z", title: "fresh" };
    const deduped = dedupeRows([stale, fresh] as unknown as WhatsOnRow[]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe("fresh");
  });
});

describe("WETHERSPOONS_DEALS", () => {
  it("every deal carries a resolvable weekly slot and non-empty terms", () => {
    for (const deal of WETHERSPOONS_DEALS) {
      const observedAt = "2026-07-12T00:00:00.000Z";
      const rows = buildWetherspoonsDealRows({ deals: [deal], venues: [CORONET], observedAt });
      expect(rows).toHaveLength(1);
      expect(deal.terms.length).toBeGreaterThan(0);
    }
    // No Friday club is currently published — see dealsRefresh.mjs governance
    // comment — so none of the hand-seeded deals should target Friday.
    expect(WETHERSPOONS_DEALS.some((d) => d.dayName === "Friday")).toBe(false);
  });

  it("carries a real first-party https source", () => {
    expect(WETHERSPOONS_FOOD_DRINK_SOURCE.url).toMatch(/^https:\/\/www\.jdwetherspoon\.com\//);
  });
});
