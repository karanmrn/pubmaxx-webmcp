import { describe, it, expect } from "vitest";

import {
  STORY_BANDS,
  validateStoryBand,
  validateAllStoryBands,
  bandMemberPubs,
  bandMemberIds,
  bandById,
  bandAnchors,
  bandsForVenue,
  venueInBand,
  type StoryBand,
} from "@/lib/storyBands";
import { landmarks } from "@/lib/landmarks";
import type { Venue } from "@/lib/venues";

// bandMemberPubs only reads latitude/longitude/hasStory/id/name — a partial cast
// keeps the fixture honest without the full Venue shape (mirrors landmarks.test).
function makeVenue(id: string, lat: number, lng: number, hasStory: boolean): Venue {
  return { id, name: id, latitude: lat, longitude: lng, hasStory } as Venue;
}

describe("story band DTO validation", () => {
  it("ships six valid bands", () => {
    expect(STORY_BANDS).toHaveLength(6);
    expect(validateAllStoryBands()).toEqual({});
  });

  it("every band anchors to real landmarks and carries >= 1 source", () => {
    for (const band of STORY_BANDS) {
      expect(validateStoryBand(band), `${band.id} problems`).toEqual([]);
      expect(bandAnchors(band).length).toBe(band.anchorLandmarkIds.length);
      expect(band.sources.length).toBeGreaterThanOrEqual(1);
      for (const source of band.sources) {
        expect(source.url).toMatch(/^https?:\/\//);
      }
    }
  });

  it("flags an unknown anchor landmark id", () => {
    const bad: StoryBand = { ...STORY_BANDS[0], anchorLandmarkIds: ["big-ben", "not-a-real-place"] };
    const problems = validateStoryBand(bad);
    expect(problems.join(" ")).toMatch(/unknown anchor landmark id/);
  });

  it("flags thin copy and a raw-hex colour token", () => {
    const bad: StoryBand = {
      ...STORY_BANDS[0],
      copy: "Too short.",
      colourToken: "#ff0000",
    };
    const problems = validateStoryBand(bad);
    expect(problems.join(" ")).toMatch(/copy too thin|sentences/);
    expect(problems.join(" ")).toMatch(/bare token name/);
  });

  it("flags a radius outside the sane range", () => {
    expect(validateStoryBand({ ...STORY_BANDS[0], radiusKm: 0 }).join(" ")).toMatch(/radiusKm/);
    expect(validateStoryBand({ ...STORY_BANDS[0], radiusKm: 99 }).join(" ")).toMatch(/radiusKm/);
  });

  it("detects a duplicate band id across the set", () => {
    const dup = validateAllStoryBands([STORY_BANDS[0], STORY_BANDS[0]]);
    expect(dup[STORY_BANDS[0].id].join(" ")).toMatch(/duplicate band id/);
  });
});

describe("bandMemberPubs matching", () => {
  const royal = bandById("royal-civic") as StoryBand;
  const bigBen = landmarks.find((l) => l.id === "big-ben")!;

  it("includes only story pubs within the radius of an anchor", () => {
    const [lng, lat] = bigBen.coordinates;
    const venues = [
      makeVenue("on-anchor-story", lat, lng, true), // 0 km from an anchor
      makeVenue("on-anchor-no-story", lat, lng, false), // excluded: not a story pub
      makeVenue("far-story", 51.7, 0.2, true), // excluded: far from every anchor
    ];
    const ids = bandMemberIds(royal, venues);
    expect(ids).toContain("on-anchor-story");
    expect(ids).not.toContain("on-anchor-no-story");
    expect(ids).not.toContain("far-story");
  });

  it("sorts members nearest-anchor first and reports the distance", () => {
    const [lng, lat] = bigBen.coordinates;
    // ~0.2 km east and ~0.02 km east of Big Ben — nearest should come first.
    const near = makeVenue("near", lat, lng + 0.0003, true);
    const mid = makeVenue("mid", lat, lng + 0.003, true);
    const members = bandMemberPubs(royal, [mid, near]);
    expect(members.map((m) => m.venue.id)).toEqual(["near", "mid"]);
    expect(members[0].km).toBeLessThan(members[1].km);
  });

  it("returns an empty list when nothing qualifies (honest fallback)", () => {
    expect(bandMemberPubs(royal, [makeVenue("nope", 51.7, 0.3, true)])).toEqual([]);
  });

  it("bandById returns undefined for an unknown/blank id", () => {
    expect(bandById("nope")).toBeUndefined();
    expect(bandById(null)).toBeUndefined();
    expect(bandById("")).toBeUndefined();
  });
});

describe("bandsForVenue membership (place stories)", () => {
  const bigBen = landmarks.find((l) => l.id === "big-ben")!;

  it("includes bands whose anchors are within radius of the venue", () => {
    const [lng, lat] = bigBen.coordinates;
    const venue = { id: "near-westminster", latitude: lat, longitude: lng };
    const bands = bandsForVenue(venue);
    const ids = bands.map((b) => b.id);
    expect(ids).toContain("royal-civic");
    expect(venueInBand(bandById("royal-civic")!, venue)).toBe(true);
  });

  it("returns [] for a venue far from every corridor", () => {
    const venue = { id: "far", latitude: 51.7, longitude: 0.25 };
    expect(bandsForVenue(venue)).toEqual([]);
    expect(venueInBand(bandById("royal-civic")!, venue)).toBe(false);
  });

  it("sorts membership nearest-corridor first", () => {
    // Tower Bridge sits on both river-history and thames-industrial; the
    // nearer corridor should come first when distances differ.
    const towerBridge = landmarks.find((l) => l.id === "tower-bridge")!;
    const [lng, lat] = towerBridge.coordinates;
    const bands = bandsForVenue({ id: "at-bridge", latitude: lat, longitude: lng });
    expect(bands.length).toBeGreaterThanOrEqual(1);
    expect(bands.map((b) => b.id)).toEqual(
      expect.arrayContaining(["river-history", "thames-industrial"]),
    );
  });
});
