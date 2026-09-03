import { describe, it, expect } from "vitest";

import { landmarks, landmarkById, nearestStoryPubs, type Landmark } from "@/lib/landmarks";
import type { Venue } from "@/lib/venues";

// nearestStoryPubs only reads latitude/longitude/hasStory/kind; a partial cast
// keeps the fixture honest without dragging in the full 30-field Venue shape.
function makeVenue(
  id: string,
  lat: number,
  lng: number,
  hasStory: boolean,
  kind?: Venue["kind"],
): Venue {
  return { id, name: id, latitude: lat, longitude: lng, hasStory, kind } as Venue;
}

const towerBridge = landmarks.find((l) => l.id === "tower-bridge") as Landmark;

describe("landmarks data", () => {
  it("every landmark carries a non-empty source URL", () => {
    // Sourcing is the product's core promise: no unsourced claim ships.
    expect(landmarks.length).toBeGreaterThan(0);
    for (const landmark of landmarks) {
      expect(landmark.source.url, `${landmark.id} source.url`).toMatch(/^https?:\/\//);
    }
  });

  it("landmarkById resolves known ids", () => {
    expect(landmarkById("tower-bridge")?.name).toBe("Tower Bridge");
    expect(landmarkById("not-real")).toBeUndefined();
  });
});

describe("nearestStoryPubs", () => {
  it("returns only story pubs, nearest first, capped at the limit", () => {
    const venues = [
      makeVenue("far-story", 51.55, -0.2, true),
      makeVenue("near-no-story", 51.5056, -0.0755, false),
      makeVenue("near-story", 51.506, -0.076, true),
      makeVenue("mid-story", 51.51, -0.09, true),
      makeVenue("mid-story-2", 51.512, -0.095, true),
    ];
    const result = nearestStoryPubs(towerBridge, venues, 3);
    expect(result.map((r) => r.venue.id)).toEqual(["near-story", "mid-story", "mid-story-2"]);
    expect(result[0].km).toBeLessThan(0.1);
    expect(result.every((r) => r.venue.hasStory)).toBe(true);
  });

  it("is empty when no venue has a story", () => {
    expect(nearestStoryPubs(towerBridge, [makeVenue("a", 51.5, -0.1, false)])).toEqual([]);
  });

  it("excludes famous bars and food venues so crawl seeding stays pub-only", () => {
    const venues = [
      makeVenue("famous-bar", 51.506, -0.076, true, "bar"),
      makeVenue("famous-food", 51.5065, -0.0765, true, "food"),
      makeVenue("story-pub", 51.51, -0.09, true, "pub"),
      makeVenue("legacy-pub", 51.512, -0.095, true),
    ];
    expect(nearestStoryPubs(towerBridge, venues, 3).map((r) => r.venue.id)).toEqual([
      "story-pub",
      "legacy-pub",
    ]);
  });
});
