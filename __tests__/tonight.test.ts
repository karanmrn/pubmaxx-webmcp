import { describe, expect, it } from "vitest";

import type { TonightOpportunity } from "@/lib/tonight";
import {
  coverageLabel,
  deriveKindFacets,
  eventChipsForVenue,
  filterByKind,
  kindSlug,
  matchOpportunitiesToVenue,
  opportunityMatchesVenue,
  provenanceLabel,
  walkLabel,
  walkMinutes,
} from "@/lib/tonight";

function op(partial: Partial<TonightOpportunity>): TonightOpportunity {
  return { title: "Untitled", ...partial };
}

describe("kindSlug", () => {
  it("falls back to 'other' for missing/blank kinds", () => {
    expect(kindSlug(op({ kind: "gig" }))).toBe("gig");
    expect(kindSlug(op({ kind: "  theatre " }))).toBe("theatre");
    expect(kindSlug(op({ kind: "" }))).toBe("other");
    expect(kindSlug(op({}))).toBe("other");
  });
});

describe("deriveKindFacets", () => {
  it("derives facets from the kinds present, most common first", () => {
    const facets = deriveKindFacets([
      op({ kind: "gig" }),
      op({ kind: "gig" }),
      op({ kind: "theatre" }),
      op({}), // → other
    ]);
    expect(facets).toEqual([
      { kind: "gig", label: "Gig", count: 2 },
      { kind: "other", label: "Other", count: 1 },
      { kind: "theatre", label: "Theatre", count: 1 },
    ]);
  });

  it("breaks count ties alphabetically by label", () => {
    const facets = deriveKindFacets([
      op({ kind: "theatre" }),
      op({ kind: "comedy" }),
    ]);
    expect(facets.map((f) => f.kind)).toEqual(["comedy", "theatre"]);
  });

  it("returns [] for an empty list", () => {
    expect(deriveKindFacets([])).toEqual([]);
  });
});

describe("filterByKind", () => {
  const ops = [op({ kind: "gig" }), op({ kind: "theatre" }), op({})];

  it("returns everything when no kind is active", () => {
    expect(filterByKind(ops, null)).toHaveLength(3);
  });

  it("filters to the active kind, treating missing kind as 'other'", () => {
    expect(filterByKind(ops, "gig")).toHaveLength(1);
    expect(filterByKind(ops, "other")).toHaveLength(1);
    expect(filterByKind(ops, "market")).toHaveLength(0);
  });
});

describe("provenanceLabel", () => {
  it("formats a valid ISO timestamp from UTC parts (timezone-stable)", () => {
    expect(provenanceLabel("2026-07-12T18:30:00Z")).toBe("Checked 12 Jul");
    expect(provenanceLabel("2026-01-01T00:00:00Z")).toBe("Checked 1 Jan");
  });

  it("labels missing/unparseable freshness honestly", () => {
    expect(provenanceLabel(null)).toBe("No date on this yet");
    expect(provenanceLabel(undefined)).toBe("No date on this yet");
    expect(provenanceLabel("not-a-date")).toBe("No date on this yet");
  });
});

describe("coverageLabel", () => {
  it("owns the zero, thin, and healthy cases honestly", () => {
    expect(coverageLabel(0)).toBe("Nothing confirmed tonight yet");
    expect(coverageLabel(1)).toBe("Thin tonight, 1 confirmed");
    expect(coverageLabel(2)).toBe("Thin tonight, 2 confirmed");
    expect(coverageLabel(7)).toBe("7 things on tonight");
  });
});

describe("walkMinutes / walkLabel", () => {
  const origin = { lat: 51.5074, lng: -0.1278 }; // Charing Cross-ish

  it("estimates a positive, clamped walk from finite coords", () => {
    const near = { lat: 51.509, lng: -0.128 };
    const mins = walkMinutes(origin, near);
    expect(mins).not.toBeNull();
    expect(mins).toBeGreaterThanOrEqual(1);
    expect(walkLabel(mins)).toBe(`~${mins} min walk`);
  });

  it("returns null (and no label) when either coord is missing/non-finite", () => {
    expect(walkMinutes(null, origin)).toBeNull();
    expect(walkMinutes(origin, undefined)).toBeNull();
    expect(walkMinutes(origin, { lat: Number.NaN, lng: -0.1 })).toBeNull();
    expect(walkLabel(null)).toBeNull();
  });

  it("clamps a co-located venue to at least 1 minute", () => {
    expect(walkMinutes(origin, origin)).toBe(1);
  });
});

describe("opportunityMatchesVenue", () => {
  const venue = {
    id: "v1",
    name: "The Blue Posts",
    latitude: 51.5133,
    longitude: -0.1349,
  };

  it("matches on a tolerant name comparison (case/the/&/punctuation)", () => {
    expect(
      opportunityMatchesVenue(op({ place: { name: "blue posts" } }), venue),
    ).toBe(true);
    expect(
      opportunityMatchesVenue(op({ place: { name: "The Blue Posts Soho" } }), venue),
    ).toBe(true);
  });

  it("matches on coordinate proximity when names differ", () => {
    const near = op({
      place: { name: "Upstairs Room", location: { lat: 51.5134, lng: -0.135 } },
    });
    expect(opportunityMatchesVenue(near, venue)).toBe(true);
  });

  it("does not match a distant, differently-named place", () => {
    const far = op({
      place: { name: "Somewhere Else", location: { lat: 51.6, lng: -0.3 } },
    });
    expect(opportunityMatchesVenue(far, venue)).toBe(false);
    expect(opportunityMatchesVenue(op({ place: { name: "No Coords Bar" } }), venue)).toBe(
      false,
    );
  });
});

describe("matchOpportunitiesToVenue / eventChipsForVenue", () => {
  const venue = { id: "v1", name: "Red Lion", latitude: 51.5, longitude: -0.12 };

  it("keeps only matching opportunities and dedups chips by kind", () => {
    const ops = [
      op({ kind: "gig", place: { name: "Red Lion" } }),
      op({ kind: "gig", place: { name: "Red Lion" } }), // dup kind
      op({ kind: "quiz" as unknown as string, place: { name: "Red Lion" } }),
      op({ kind: "comedy", place: { name: "Far Tavern", location: { lat: 52, lng: 1 } } }),
    ];
    const matched = matchOpportunitiesToVenue(ops, venue);
    expect(matched).toHaveLength(3); // the far comedy is excluded
    const chips = eventChipsForVenue(matched);
    expect(chips.map((c) => c.kind)).toEqual(["gig", "quiz"]);
    expect(chips[0]).toEqual({ kind: "gig", label: "Gig" });
  });

  it("returns [] chips when nothing matches", () => {
    expect(eventChipsForVenue([])).toEqual([]);
  });
});
