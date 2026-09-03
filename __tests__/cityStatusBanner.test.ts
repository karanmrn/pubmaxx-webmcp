import { describe, expect, it } from "vitest";

import {
  groupSignalsByKind,
  isSevereCityStatus,
  normaliseSignalKind,
  pickCityStatusHeadline,
} from "@/components/map/CityStatusBanner";

describe("pickCityStatusHeadline", () => {
  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"])(
    "rejects unsafe sourceUrl scheme %s",
    (sourceUrl) => {
      const headline = pickCityStatusHeadline({
        signals: [{ headline: "Signal headline", sourceUrl }],
      });

      expect(headline).toMatchObject({ text: "Signal headline", kind: "signal" });
      expect(headline?.href).toBeUndefined();
    },
  );

  it("accepts an absolute https sourceUrl", () => {
    const headline = pickCityStatusHeadline({
      signals: [
        {
          headline: "Signal headline",
          sourceUrl: "https://example.com/london-status",
        },
      ],
    });

    expect(headline?.href).toBe("https://example.com/london-status");
  });
});

// A4 — group-by-kind for the expandable "Tonight in London" sheet.
describe("groupSignalsByKind", () => {
  it("returns [] for empty/undefined input", () => {
    expect(groupSignalsByKind(undefined)).toEqual([]);
    expect(groupSignalsByKind([])).toEqual([]);
  });

  it("groups mixed kinds into alert/transport/event/other in fixed order", () => {
    const groups = groupSignalsByKind([
      { headline: "Gig at Wembley", kind: "event" },
      { headline: "Wildfire risk", kind: "alert" },
      { headline: "Tube strike", kind: "Transport" },
      { headline: "Mystery", kind: "weird-kind" },
      { headline: "Second gig", kind: "gig" },
      { headline: "No kind at all" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["alert", "transport", "event", "other"]);
    expect(groups[0].signals.map((s) => s.headline)).toEqual(["Wildfire risk"]);
    expect(groups[1].signals.map((s) => s.headline)).toEqual(["Tube strike"]);
    // Upstream relative order preserved within a bucket.
    expect(groups[2].signals.map((s) => s.headline)).toEqual(["Gig at Wembley", "Second gig"]);
    expect(groups[3].signals.map((s) => s.headline)).toEqual(["Mystery", "No kind at all"]);
  });

  it("normalises kind aliases", () => {
    expect(normaliseSignalKind("TfL")).toBe("transport");
    expect(normaliseSignalKind("gigs")).toBe("event");
    expect(normaliseSignalKind("ALERTS")).toBe("alert");
    expect(normaliseSignalKind(undefined)).toBe("other");
  });
});

describe("isSevereCityStatus", () => {
  it("shows for major and notable signals", () => {
    expect(isSevereCityStatus({ kind: "signal", severity: "major" })).toBe(true);
    expect(isSevereCityStatus({ kind: "signal", severity: "notable" })).toBe(true);
  });

  it("shows for live tube disruption", () => {
    expect(isSevereCityStatus({ kind: "tube", severity: "notable" })).toBe(true);
    expect(isSevereCityStatus({ kind: "weather", severity: "info" }, 2)).toBe(true);
  });

  it("hides mundane weather and info-only notes (boot clutter)", () => {
    expect(isSevereCityStatus({ kind: "weather", severity: "info" })).toBe(false);
    expect(isSevereCityStatus({ kind: "signal", severity: "info" })).toBe(false);
    expect(isSevereCityStatus(null)).toBe(false);
  });
});
