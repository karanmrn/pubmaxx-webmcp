import { describe, expect, it } from "vitest";

import {
  buildMusicResidencyRows,
  IVY_HOUSE_SOURCE,
  MUSIC_RESIDENCIES,
  SKEHANS_SOURCE,
} from "../scripts/whatson/musicRefresh.mjs";
import { dedupeKey, dedupeRows, isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";

describe("buildMusicResidencyRows", () => {
  const observedAt = "2026-07-12T00:00:00.000Z"; // a Sunday

  it("builds one row per residency definition", () => {
    const rows = buildMusicResidencyRows({ residencies: MUSIC_RESIDENCIES, observedAt });
    expect(rows).toHaveLength(MUSIC_RESIDENCIES.length);
  });

  it("emits the B1 row contract shape with kind:'music', confidence:'listed', and real provenance", () => {
    const rows = buildMusicResidencyRows({
      residencies: [MUSIC_RESIDENCIES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: "music-skehans-monday-jam",
      placeName: "Skehan's",
      kind: "music",
      startsAt: "2026-07-13T20:30:00+01:00",
      title: "Monday Jam Sessions",
      source: SKEHANS_SOURCE,
      observedAt,
      confidence: "listed",
    });
    expect(row.detail).toBeTruthy();
  });

  it("passes isValidWhatsOnRow (the spine's own guard) for every residency", () => {
    const rows = buildMusicResidencyRows({ residencies: MUSIC_RESIDENCIES, observedAt });
    const now = Date.parse("2026-07-12T12:00:00.000Z");
    for (const row of rows) {
      expect(isValidWhatsOnRow(row as unknown, now)).toBe(true);
    }
  });

  it("resolves the Sunday jazz slot for the very same day when observed before its start time", () => {
    const rows = buildMusicResidencyRows({
      residencies: MUSIC_RESIDENCIES.filter((r) => r.id === "ivyhouse-sunday-jazz"),
      observedAt: "2026-07-12T08:00:00.000Z", // Sunday morning, before 16:00
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].startsAt).toBe("2026-07-12T16:00:00+01:00");
    expect(rows[0].source).toEqual(IVY_HOUSE_SOURCE);
  });

  it("rolls over to next week when observed after the slot's start time on the same day", () => {
    const rows = buildMusicResidencyRows({
      residencies: MUSIC_RESIDENCIES.filter((r) => r.id === "ivyhouse-sunday-jazz"),
      observedAt: "2026-07-12T20:00:00.000Z", // Sunday evening, after 16:00
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].startsAt).toBe("2026-07-19T16:00:00+01:00");
  });

  it("resolves a residency slot the right side of a DST switch", () => {
    // Friday 27 Mar 2026 (GMT) — the next Monday, 30 Mar, falls AFTER the UK
    // clocks-forward switch on 29 Mar 2026, so the resolved slot must carry
    // the BST (+01:00) offset even though `observedAt` itself is GMT.
    const rows = buildMusicResidencyRows({
      residencies: MUSIC_RESIDENCIES.filter((r) => r.id === "skehans-monday-jam"),
      observedAt: "2026-03-27T10:00:00.000Z",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].startsAt).toBe("2026-03-30T20:30:00+01:00");
  });

  it("drops a residency with a malformed day/time rather than guessing", () => {
    const rows = buildMusicResidencyRows({
      residencies: [{ ...MUSIC_RESIDENCIES[0], dayName: "Notaday" }],
      observedAt,
    });
    expect(rows).toHaveLength(0);
  });

  it("drops a residency with no placeName or no id", () => {
    const rows = buildMusicResidencyRows({
      residencies: [
        { ...MUSIC_RESIDENCIES[0], placeName: undefined as unknown as string },
        { ...MUSIC_RESIDENCIES[0], id: undefined as unknown as string },
      ],
      observedAt,
    });
    expect(rows).toHaveLength(0);
  });

  it("drops a residency with empty or missing title/detail", () => {
    const rows = buildMusicResidencyRows({
      residencies: [
        { ...MUSIC_RESIDENCIES[0], title: "" },
        { ...MUSIC_RESIDENCIES[0], title: undefined as unknown as string },
        { ...MUSIC_RESIDENCIES[0], detail: "" },
        { ...MUSIC_RESIDENCIES[0], detail: undefined as unknown as string },
      ],
      observedAt,
    });
    expect(rows).toHaveLength(0);
  });

  it("every residency produces a distinct, non-colliding row (dedupeKey / dedupeRows)", () => {
    const rows = buildMusicResidencyRows({ residencies: MUSIC_RESIDENCIES, observedAt });
    const keys = new Set(rows.map((r) => dedupeKey(r as WhatsOnRow)));
    expect(keys.size).toBe(rows.length);
    expect(dedupeRows(rows as WhatsOnRow[])).toHaveLength(rows.length);
  });

  it("dedupeRows collapses two rows landing on the same (place, kind, startsAt), keeping the freshest", () => {
    const rows = buildMusicResidencyRows({
      residencies: [MUSIC_RESIDENCIES[0]],
      observedAt,
    });
    const stale = { ...rows[0], id: "stale-dupe", observedAt: "2026-07-01T00:00:00.000Z", title: "stale" };
    const fresh = { ...rows[0], id: "fresh-dupe", observedAt: "2026-07-12T00:00:00.000Z", title: "fresh" };
    const deduped = dedupeRows([stale, fresh] as unknown as WhatsOnRow[]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe("fresh");
  });
});

describe("MUSIC_RESIDENCIES", () => {
  it("every residency carries a resolvable weekly slot and a real first-party https source", () => {
    for (const res of MUSIC_RESIDENCIES) {
      const observedAt = "2026-07-12T00:00:00.000Z";
      const rows = buildMusicResidencyRows({ residencies: [res], observedAt });
      expect(rows).toHaveLength(1);
      expect(res.source.url).toMatch(/^https:\/\//);
    }
  });

  it("carries at least four independently-verified first-party venues (round-2 coverage floor)", () => {
    const venues = new Set(MUSIC_RESIDENCIES.map((r) => r.placeName));
    expect(venues.size).toBeGreaterThanOrEqual(4);
  });

  it("spans at least three distinct first-party source domains (no single-source coverage)", () => {
    const domains = new Set(MUSIC_RESIDENCIES.map((r) => new URL(r.source.url).hostname));
    expect(domains.size).toBeGreaterThanOrEqual(3);
  });
});
