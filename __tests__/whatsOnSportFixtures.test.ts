import { describe, expect, it } from "vitest";

import {
  buildSportFixtureRows,
  buildSportFixtureRowsWithDiagnostics,
  londonWallClockToIso,
  SPORT_FIXTURES,
} from "../scripts/whatson/sportFixtures.mjs";
import { dedupeKey, dedupeRows, isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";

const ARKLES = {
  id: "sport-attr-gk-arkles",
  venueId: "venue-17ivo1z",
  placeName: "Arkles",
  lat: 53.4303544,
  lng: -2.9574746,
  kind: "sport",
  title: "Shows live sport",
  detail: "Greene King lists this pub as a live-sport venue.",
  source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/merseyside/arkles" },
  observedAt: "2026-07-11T21:26:43.108Z",
  confidence: "listed",
};

const BARON = {
  id: "sport-attr-gk-baron-of-beef",
  venueId: "venue-19rm2vj",
  placeName: "Baron of Beef",
  lat: 52.2089164,
  lng: 0.1181145,
  kind: "sport",
  title: "Shows live sport",
  detail: "Greene King lists this pub as a live-sport venue.",
  source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/cambridgeshire/baron-of-beef" },
  observedAt: "2026-07-11T21:26:43.108Z",
  confidence: "listed",
};

// No coordinates, no venueId — mirrors a Greene King record whose lat/lng were
// never resolved (gkVenueIdFromRecord returns null in that case).
const PROSPECT_NO_COORDS = {
  id: "sport-attr-gk-prospect-of-whitby",
  placeName: "Prospect of Whitby",
  kind: "sport",
  title: "Shows live sport",
  source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby" },
  observedAt: "2026-07-11T21:26:43.108Z",
  confidence: "listed",
};

describe("londonWallClockToIso", () => {
  it("resolves a BST (summer, +01:00) wall-clock kickoff", () => {
    // 20:00 London on 14 Jul 2026 (BST) = 19:00Z.
    expect(londonWallClockToIso("2026-07-14", "20:00")).toBe("2026-07-14T20:00:00+01:00");
    expect(new Date(londonWallClockToIso("2026-07-14", "20:00")!).toISOString()).toBe(
      "2026-07-14T19:00:00.000Z",
    );
  });

  it("resolves a GMT (winter, +00:00) wall-clock kickoff — DST correctness", () => {
    // 15:00 London on 28 Dec 2026 (GMT, no DST) = 15:00Z.
    expect(londonWallClockToIso("2026-12-28", "15:00")).toBe("2026-12-28T15:00:00+00:00");
    expect(new Date(londonWallClockToIso("2026-12-28", "15:00")!).toISOString()).toBe(
      "2026-12-28T15:00:00.000Z",
    );
  });

  it("returns null on a malformed date or time rather than guessing", () => {
    expect(londonWallClockToIso("not-a-date", "20:00")).toBeNull();
    expect(londonWallClockToIso("2026-07-14", "25:99")).toBeNull();
    expect(londonWallClockToIso("2026-07-14", "bad")).toBeNull();
    expect(londonWallClockToIso(undefined, undefined)).toBeNull();
  });

  it("returns null on a calendar date that doesn't exist, rather than rolling over", () => {
    // February 2026 has 28 days (not a leap year) — JS Date rollover
    // semantics would otherwise silently turn this into 2026-03-02.
    expect(londonWallClockToIso("2026-02-30", "12:00")).toBeNull();
    expect(londonWallClockToIso("2026-04-31", "12:00")).toBeNull();
    expect(londonWallClockToIso("2026-13-01", "12:00")).toBeNull();
    expect(londonWallClockToIso("2026-07-00", "12:00")).toBeNull();
  });

  it("returns null in the spring-forward DST gap (a wall-clock hour that never happens)", () => {
    // Europe/London clocks jump 01:00 -> 02:00 on the last Sunday of March
    // 2026 (29 Mar); 01:30 local time that day does not exist.
    expect(londonWallClockToIso("2026-03-29", "01:30")).toBeNull();
    // The instant either side of the gap resolves fine.
    expect(londonWallClockToIso("2026-03-29", "00:30")).toBe("2026-03-29T00:30:00+00:00");
    expect(londonWallClockToIso("2026-03-29", "02:30")).toBe("2026-03-29T02:30:00+01:00");
  });

  it("deterministically resolves the autumn fall-back ambiguous hour to the later (GMT) occurrence", () => {
    // Europe/London clocks go back 02:00 -> 01:00 on the last Sunday of
    // October 2026 (25 Oct), so 01:30 local occurs twice: once at BST
    // (+01:00, the earlier instant) and once at GMT (+00:00, the later
    // instant). This resolves to the later, GMT instant — never a guess,
    // just a documented, stable choice (see the function's doc comment).
    const iso = londonWallClockToIso("2026-10-25", "01:30");
    expect(iso).toBe("2026-10-25T01:30:00+00:00");
    expect(new Date(iso!).toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });
});

describe("buildSportFixtureRows", () => {
  const observedAt = "2026-07-12T00:00:00.000Z";

  it("crosses every fixture against every screening pub", () => {
    const fixtures = [SPORT_FIXTURES[0]];
    const rows = buildSportFixtureRows({ attributeRows: [ARKLES, BARON], fixtures, observedAt });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.placeName).sort()).toEqual(["Arkles", "Baron of Beef"]);
  });

  it("emits the B1 row contract shape with confidence:'derived' and dual provenance", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [ARKLES],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: "sport-fixture-wc2026-final-esp-arg-arkles",
      placeName: "Arkles",
      venueId: "venue-17ivo1z",
      lat: 53.4303544,
      lng: -2.9574746,
      kind: "sport",
      startsAt: "2026-07-19T20:00:00+01:00",
      title: "Spain v Argentina - FIFA World Cup Final",
      source: { label: "Greene King", url: ARKLES.source.url },
      observedAt,
      confidence: "derived",
    });
    // Both provenances honestly present: the venue-specific screening source
    // (structured `source`) AND the fixture's own source — BOTH the label
    // AND the URL — named in prose.
    expect(row.detail).toContain("Greene King-listed");
    expect(row.detail).toContain("not confirmed by the venue");
    expect(row.detail).toContain(SPORT_FIXTURES[0].source.label);
    expect(row.detail).toContain(SPORT_FIXTURES[0].source.url);
  });

  it("passes isValidWhatsOnRow (the spine's own guard)", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [ARKLES],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    const now = Date.parse("2026-07-12T12:00:00.000Z");
    expect(isValidWhatsOnRow(rows[0] as unknown, now)).toBe(true);
  });

  it("omits venueId/lat/lng when the attribute row lacks coordinates (never invented)", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [PROSPECT_NO_COORDS],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("venueId");
    expect(rows[0]).not.toHaveProperty("lat");
    expect(rows[0]).not.toHaveProperty("lng");
  });

  it("drops a fixture whose kickoff cannot be resolved, rather than fabricating a time", () => {
    const badFixture = { ...SPORT_FIXTURES[0], kickoffLondonTime: "not-a-time" };
    const rows = buildSportFixtureRows({ attributeRows: [ARKLES], fixtures: [badFixture], observedAt });
    expect(rows).toHaveLength(0);
  });

  it("drops a fixture whose own source URL isn't a real absolute http(s) URL", () => {
    const badFixture = { ...SPORT_FIXTURES[0], source: { label: "bad", url: "not-a-url" } };
    const rows = buildSportFixtureRows({ attributeRows: [ARKLES], fixtures: [badFixture], observedAt });
    expect(rows).toHaveLength(0);
  });

  it("drops an attribute row with no placeName or no source url", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [{ ...ARKLES, placeName: undefined }, { ...ARKLES, source: {} }],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(0);
  });

  it("ignores non-sport attribute rows", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [{ ...ARKLES, kind: "quiz" }],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(0);
  });

  it("every fixture x one pub produces a distinct, non-colliding row", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [ARKLES],
      fixtures: SPORT_FIXTURES,
      observedAt,
    });
    expect(rows).toHaveLength(SPORT_FIXTURES.length);
    // Each fixture kicks off at a distinct instant, so no two rows collide on
    // the (place, kind, startsAt) dedupe key at a single pub.
    const keys = new Set(rows.map((r) => dedupeKey(r as WhatsOnRow)));
    expect(keys.size).toBe(SPORT_FIXTURES.length);
    expect(dedupeRows(rows as WhatsOnRow[])).toHaveLength(SPORT_FIXTURES.length);
  });

  it("dedupeRows collapses two rows that land on the same (place, kind, startsAt), keeping the freshest", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [ARKLES],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    const stale = { ...rows[0], id: "stale-dupe", observedAt: "2026-07-01T00:00:00.000Z", title: "stale" };
    const fresh = { ...rows[0], id: "fresh-dupe", observedAt: "2026-07-12T00:00:00.000Z", title: "fresh" };
    const deduped = dedupeRows([stale, fresh] as unknown as WhatsOnRow[]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe("fresh");
  });
});

describe("buildSportFixtureRowsWithDiagnostics", () => {
  const observedAt = "2026-07-12T00:00:00.000Z";

  it("reports a dropped fixture with its reason, never silently", () => {
    const badFixture = { ...SPORT_FIXTURES[0], kickoffLondonTime: "not-a-time" };
    const { rows, diagnostics } = buildSportFixtureRowsWithDiagnostics({
      attributeRows: [ARKLES],
      fixtures: [badFixture],
      observedAt,
    });
    expect(rows).toHaveLength(0);
    expect(diagnostics.droppedFixtures).toHaveLength(1);
    expect(diagnostics.droppedFixtures[0]).toMatchObject({
      id: badFixture.id,
      reason: "unresolved kickoff",
    });
  });

  it("reports dropped (fixture, pub) pairs with a reason, never silently", () => {
    const { rows, diagnostics } = buildSportFixtureRowsWithDiagnostics({
      attributeRows: [{ ...ARKLES, placeName: undefined }, { ...ARKLES, source: {} }],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(0);
    expect(diagnostics.droppedAttributeRows).toHaveLength(2);
  });
});

describe("SPORT_FIXTURES", () => {
  it("every fixture carries a real http(s) source (label + url) and a resolvable kickoff", () => {
    for (const fixture of SPORT_FIXTURES) {
      expect(fixture.source.url).toMatch(/^https:\/\//);
      expect(fixture.source.label.length).toBeGreaterThan(0);
      expect(londonWallClockToIso(fixture.kickoffLondonDate, fixture.kickoffLondonTime)).not.toBeNull();
    }
  });

  it("every fixture resolves to a DISTINCT kickoff instant (no dedupe-key collision at a single pub)", () => {
    // Two fixtures at the same instant would collide on (place, kind, startsAt)
    // for any one pub and silently collapse to one derived row (dedupeRows).
    const instants = SPORT_FIXTURES.map((f) =>
      londonWallClockToIso(f.kickoffLondonDate, f.kickoffLondonTime),
    );
    expect(new Set(instants).size).toBe(SPORT_FIXTURES.length);
  });

  it("ships confirmed teams, not placeholders (both finalists / all matchweek-1 pairings resolved by refresh time)", () => {
    for (const fixture of SPORT_FIXTURES) {
      expect(fixture.title).not.toMatch(/TBC|TBD|winner of/i);
    }
  });

  it("keeps served copy free of typographic (em/en) dashes", () => {
    for (const fixture of SPORT_FIXTURES) {
      expect(fixture.title).not.toMatch(/[—–]/);
    }
  });
});
