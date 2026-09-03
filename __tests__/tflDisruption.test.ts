import { describe, it, expect } from "vitest";

import {
  LINE_PATCH_RELEVANCE,
  relevantLineIdsForPatch,
  isLiveMaterialSeverity,
  isPlannedClosureSeverity,
  tonightWindow,
  periodOverlapsTonight,
  materialDisruptionsFor,
  pickTopDisruption,
  describeDisruption,
  disruptionForPatch,
  lineDisplayLabel,
  NIGHT_WINDOW_OPEN_HOUR,
  NIGHT_WINDOW_CLOSE_HOUR,
  type RawLineStatus,
  type MaterialDisruption,
} from "@/lib/tflDisruption";
import { NIGHT_PATCHES } from "@/lib/nightPatches";

// Hermetic: every test drives fixtures and fixed Dates. No network, no clock —
// fetchLineStatuses (the only impure export) is deliberately left untested here,
// exactly as lib/tfl.ts keeps its fetch out of the unit surface.

// A London evening instant: 2026-07-24 (a Friday) at 20:00 BST == 19:00Z.
const FRIDAY_EVENING = new Date("2026-07-24T19:00:00Z");
// Just after midnight the same night: 2026-07-25 00:30 BST == 2026-07-24 23:30Z.
const AFTER_MIDNIGHT = new Date("2026-07-24T23:30:00Z");

function status(id: string, name: string, severity: number): RawLineStatus {
  return {
    id,
    name,
    lineStatuses: [{ statusSeverity: severity, statusSeverityDescription: name }],
  };
}

describe("line display labels", () => {
  it.each([
    ["Elizabeth line", "Elizabeth line"],
    ["Victoria", "Victoria line"],
    ["Weaver", "Weaver line"],
  ])("formats %s as %s", (name, expected) => {
    expect(lineDisplayLabel(name)).toBe(expected);
  });
});

describe("severity classification (filter boundaries)", () => {
  it("treats Closed/Suspended/Part Suspended/Severe Delays as live-material", () => {
    expect(isLiveMaterialSeverity(1)).toBe(true); // Closed
    expect(isLiveMaterialSeverity(2)).toBe(true); // Suspended
    expect(isLiveMaterialSeverity(3)).toBe(true); // Part Suspended
    expect(isLiveMaterialSeverity(6)).toBe(true); // Severe Delays
  });

  it("does NOT treat Reduced Service / Minor Delays / Good Service as material", () => {
    expect(isLiveMaterialSeverity(7)).toBe(false); // Reduced Service
    expect(isLiveMaterialSeverity(9)).toBe(false); // Minor Delays
    expect(isLiveMaterialSeverity(10)).toBe(false); // Good Service
  });

  it("does NOT treat Special Service (0) or overnight Service Closed (20) as material", () => {
    // The numeric scale's most-severe end (0) and its overnight tail (16/20) are
    // not disruptions — materiality is keyed to named codes, not a raw threshold.
    expect(isLiveMaterialSeverity(0)).toBe(false);
    expect(isLiveMaterialSeverity(16)).toBe(false);
    expect(isLiveMaterialSeverity(20)).toBe(false);
  });

  it("classifies planned closures (4/5/11) as planned, not live", () => {
    expect(isPlannedClosureSeverity(4)).toBe(true); // Planned Closure
    expect(isPlannedClosureSeverity(5)).toBe(true); // Part Closure
    expect(isPlannedClosureSeverity(11)).toBe(true); // Part Closed
    expect(isLiveMaterialSeverity(4)).toBe(false);
    expect(isPlannedClosureSeverity(6)).toBe(false); // Severe Delays is live, not planned
  });

  it("guards undefined / null severity", () => {
    expect(isLiveMaterialSeverity(undefined)).toBe(false);
    expect(isLiveMaterialSeverity(null)).toBe(false);
    expect(isPlannedClosureSeverity(undefined)).toBe(false);
  });
});

describe("tonightWindow", () => {
  it("spans 17:00 to 02:00 London for an evening now", () => {
    const { start, end } = tonightWindow(FRIDAY_EVENING);
    // 17:00 BST on 2026-07-24 == 16:00Z; 02:00 BST on 2026-07-25 == 01:00Z.
    expect(new Date(start).toISOString()).toBe("2026-07-24T16:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-07-25T01:00:00.000Z");
    expect(NIGHT_WINDOW_OPEN_HOUR).toBe(17);
    expect(NIGHT_WINDOW_CLOSE_HOUR).toBe(2);
  });

  it("rolls the evening back a day when now is before 02:00 (still the same night)", () => {
    const { start, end } = tonightWindow(AFTER_MIDNIGHT);
    // At 00:30 we are still inside the night that opened at 17:00 the prior day.
    expect(new Date(start).toISOString()).toBe("2026-07-24T16:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-07-25T01:00:00.000Z");
  });

  it.each([
    {
      name: "spring forward",
      now: new Date("2026-03-28T20:00:00Z"),
      expectedStart: "2026-03-28T17:00:00.000Z",
      expectedEnd: "2026-03-29T01:00:00.000Z",
    },
    {
      name: "autumn fall back",
      now: new Date("2026-10-24T19:00:00Z"),
      expectedStart: "2026-10-24T16:00:00.000Z",
      expectedEnd: "2026-10-25T02:00:00.000Z",
    },
  ])("converts each $name boundary with its own London offset", ({ now, expectedStart, expectedEnd }) => {
    const { start, end } = tonightWindow(now);
    expect(new Date(start).toISOString()).toBe(expectedStart);
    expect(new Date(end).toISOString()).toBe(expectedEnd);
  });
});

describe("periodOverlapsTonight", () => {
  const window = tonightWindow(FRIDAY_EVENING); // [16:00Z, 01:00Z next day)

  it("overlaps when a closure window covers tonight", () => {
    expect(
      periodOverlapsTonight(
        { fromDate: "2026-07-24T22:00:00Z", toDate: "2026-07-25T00:30:00Z" },
        window,
      ),
    ).toBe(true);
  });

  it("does not overlap a closure that is entirely next weekend", () => {
    expect(
      periodOverlapsTonight(
        { fromDate: "2026-07-31T22:00:00Z", toDate: "2026-08-01T05:00:00Z" },
        window,
      ),
    ).toBe(false);
  });

  it("does not overlap a closure that ended earlier today before the window opened", () => {
    expect(
      periodOverlapsTonight(
        { fromDate: "2026-07-24T05:00:00Z", toDate: "2026-07-24T10:00:00Z" },
        window,
      ),
    ).toBe(false);
  });

  it("touching-at-the-edge does not count (half-open interval)", () => {
    // Ends exactly at window.start -> no overlap.
    expect(
      periodOverlapsTonight(
        { fromDate: "2026-07-24T10:00:00Z", toDate: "2026-07-24T16:00:00Z" },
        window,
      ),
    ).toBe(false);
  });

  it("falls back to isNow when dates are missing", () => {
    expect(periodOverlapsTonight({ isNow: true }, window)).toBe(true);
    expect(periodOverlapsTonight({ isNow: false }, window)).toBe(false);
    expect(periodOverlapsTonight({}, window)).toBe(false);
  });
});

describe("materialDisruptionsFor", () => {
  const window = tonightWindow(FRIDAY_EVENING);

  it("keeps a live suspension on a relevant line", () => {
    const found = materialDisruptionsFor(
      [status("victoria", "Victoria", 2)],
      new Set(["victoria"]),
      window,
    );
    expect(found).toEqual([
      { lineId: "victoria", lineName: "Victoria", kind: "suspended", reason: null },
    ]);
  });

  it("drops a disruption on a line NOT relevant to the patch", () => {
    const found = materialDisruptionsFor(
      [status("jubilee", "Jubilee", 2)],
      new Set(["victoria"]),
      window,
    );
    expect(found).toEqual([]);
  });

  it("drops non-material severities (Minor Delays / Good Service)", () => {
    const found = materialDisruptionsFor(
      [status("victoria", "Victoria", 9), status("northern", "Northern", 10)],
      new Set(["victoria", "northern"]),
      window,
    );
    expect(found).toEqual([]);
  });

  it("keeps a planned closure only when its window is tonight", () => {
    const tonightClosure: RawLineStatus = {
      id: "northern",
      name: "Northern",
      lineStatuses: [
        {
          statusSeverity: 4,
          statusSeverityDescription: "Planned Closure",
          reason: "Northern line: Saturday closure for engineering works.",
          validityPeriods: [{ fromDate: "2026-07-24T22:30:00Z", toDate: "2026-07-25T00:45:00Z" }],
        },
      ],
    };
    const nextWeek: RawLineStatus = {
      id: "victoria",
      name: "Victoria",
      lineStatuses: [
        {
          statusSeverity: 4,
          statusSeverityDescription: "Planned Closure",
          validityPeriods: [{ fromDate: "2026-08-01T00:00:00Z", toDate: "2026-08-02T05:00:00Z" }],
        },
      ],
    };
    const found = materialDisruptionsFor(
      [tonightClosure, nextWeek],
      new Set(["northern", "victoria"]),
      window,
    );
    expect(found.map((d) => d.lineId)).toEqual(["northern"]);
    expect(found[0].kind).toBe("planned_closure");
    expect(found[0].reason).toContain("engineering works");
  });

  it("returns at most the most-material status per line", () => {
    const multi: RawLineStatus = {
      id: "central",
      name: "Central",
      lineStatuses: [
        { statusSeverity: 6, statusSeverityDescription: "Severe Delays" },
        { statusSeverity: 2, statusSeverityDescription: "Suspended" },
      ],
    };
    const found = materialDisruptionsFor([multi], new Set(["central"]), window);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("suspended"); // suspended outranks severe delays
  });

  it("is silent for empty inputs", () => {
    expect(materialDisruptionsFor([], new Set(["victoria"]), window)).toEqual([]);
    expect(materialDisruptionsFor(null, new Set(["victoria"]), window)).toEqual([]);
    expect(materialDisruptionsFor([status("victoria", "Victoria", 2)], new Set(), window)).toEqual([]);
  });
});

describe("pickTopDisruption ordering", () => {
  it("prefers a full closure/suspension over severe delays", () => {
    const list: MaterialDisruption[] = [
      { lineId: "central", lineName: "Central", kind: "severe_delays", reason: null },
      { lineId: "victoria", lineName: "Victoria", kind: "suspended", reason: null },
    ];
    expect(pickTopDisruption(list)?.lineId).toBe("victoria");
  });

  it("returns null for an empty list", () => {
    expect(pickTopDisruption([])).toBeNull();
  });
});

describe("describeDisruption copy", () => {
  it("is plain register with a what-to-do tail and no em dashes", () => {
    const line = describeDisruption({
      lineId: "victoria",
      lineName: "Victoria",
      kind: "suspended",
      reason: null,
    });
    expect(line).toBe("Victoria line suspended tonight, plan the bus or the walk");
    expect(line).not.toMatch(/[—–]/);
  });

  it("covers every material kind and never contains an em/en dash", () => {
    const kinds: MaterialDisruption["kind"][] = [
      "closed",
      "suspended",
      "part_suspended",
      "severe_delays",
      "planned_closure",
      "part_closure",
    ];
    for (const kind of kinds) {
      const line = describeDisruption({ lineId: "x", lineName: "Test", kind, reason: null });
      expect(line.length).toBeGreaterThan(0);
      expect(line).toMatch(/tonight/);
      expect(line).not.toMatch(/[—–]/);
    }
  });
});

describe("patch relevance mapping", () => {
  it("has an entry for every night patch and none extra", () => {
    const patchIds = NIGHT_PATCHES.map((p) => p.id).sort();
    const tableIds = Object.keys(LINE_PATCH_RELEVANCE).sort();
    expect(tableIds).toEqual(patchIds);
  });

  it("maps the Victoria line to Brixton but not to Camden", () => {
    expect(relevantLineIdsForPatch("brixton").has("victoria")).toBe(true);
    expect(relevantLineIdsForPatch("camden").has("victoria")).toBe(false);
  });

  it("maps overground to Hackney", () => {
    const hackney = relevantLineIdsForPatch("hackney");
    expect(hackney.has("london-overground") || hackney.has("weaver")).toBe(true);
  });

  it("returns an empty set for an unknown patch", () => {
    expect(relevantLineIdsForPatch("nowhere").size).toBe(0);
  });
});

describe("disruptionForPatch (end-to-end, pure)", () => {
  it("surfaces a Victoria suspension for Brixton tonight", () => {
    const result = disruptionForPatch(
      [status("victoria", "Victoria", 2)],
      "brixton",
      FRIDAY_EVENING,
    );
    expect(result).not.toBeNull();
    expect(result?.patchId).toBe("brixton");
    expect(result?.patchLabel).toBe("Brixton");
    expect(result?.lineId).toBe("victoria");
    expect(result?.line).toBe("Victoria line suspended tonight, plan the bus or the walk");
  });

  it("is silent when the same suspension is on a line irrelevant to the patch", () => {
    // Victoria does not serve Camden, so a Victoria suspension is not Camden's problem.
    expect(
      disruptionForPatch([status("victoria", "Victoria", 2)], "camden", FRIDAY_EVENING),
    ).toBeNull();
  });

  it("is silent when everything relevant is running well (no empty state)", () => {
    expect(
      disruptionForPatch(
        [status("victoria", "Victoria", 10), status("bakerloo", "Bakerloo", 9)],
        "soho",
        FRIDAY_EVENING,
      ),
    ).toBeNull();
  });

  it("is silent for a null payload (fetch failed) and an unknown patch", () => {
    expect(disruptionForPatch(null, "soho", FRIDAY_EVENING)).toBeNull();
    expect(disruptionForPatch([status("victoria", "Victoria", 2)], "nowhere", FRIDAY_EVENING)).toBeNull();
  });

  it("picks the most central spine on a tie, then the most material status", () => {
    // Soho relevance order leads with victoria; a suspension there outranks a
    // severe-delay on central even though both are material.
    const result = disruptionForPatch(
      [status("central", "Central", 6), status("victoria", "Victoria", 2)],
      "soho",
      FRIDAY_EVENING,
    );
    expect(result?.lineId).toBe("victoria");
  });
});
