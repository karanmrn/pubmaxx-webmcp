import { describe, expect, it } from "vitest";

import {
  demoDropsFor,
  demoPintDrops,
  demoPintDropsForCity,
  londonDemoPintDrops,
  manchesterDemoPintDrops,
} from "@/lib/pintDropSeeds";
import { listAllVisiblePintDrops, listVisiblePintDrops } from "@/lib/pintDrops";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import dataset from "../public/data/pint_prices_app_dataset.json";

const venues = groupVenuePrices(dataset as VenuePrice[]);
const venueById = new Map(venues.map((venue) => [venue.id, venue]));

describe("demo Pint Drop seeds", () => {
  it("London seeds are 8-16 drops, all provenance-tagged demo and visible", () => {
    expect(londonDemoPintDrops.length).toBeGreaterThanOrEqual(8);
    expect(londonDemoPintDrops.length).toBeLessThanOrEqual(16);
    for (const drop of londonDemoPintDrops) {
      expect(drop.provenance).toBe("demo");
      expect(drop.status).toBe("visible");
    }
  });

  it("every London seed venueId resolves to a real curated heritage venue in the dataset", () => {
    for (const drop of londonDemoPintDrops) {
      const venue = venueById.get(drop.venueId);
      expect(venue, `seed ${drop.id} points at missing venue ${drop.venueId}`).toBeDefined();
      // These are the curated heritage pubs — each carries an editorial note.
      expect(venue!.curation.heritageNote, `${venue!.name} is not curated`).toBeTruthy();
    }
  });

  it("every London seed carries the story layer: a note, a handle, and a sane price", () => {
    for (const drop of londonDemoPintDrops) {
      expect(drop.passedDownNote.trim().length).toBeGreaterThan(0);
      expect(drop.passedDownNote.length).toBeLessThanOrEqual(500);
      expect(drop.handle.startsWith("@")).toBe(true);
      expect(drop.priceGbp).toBeGreaterThan(0);
      expect(drop.priceGbp).toBeLessThanOrEqual(20);
      expect(drop.id.startsWith("seed-")).toBe(true);
    }
    // Ids are unique across the combined city seed list.
    expect(new Set(demoPintDrops.map((d) => d.id)).size).toBe(demoPintDrops.length);
  });

  it("stamps demo drops as tonight-fresh rather than weeks-old content", () => {
    const now = Date.now();
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const created = londonDemoPintDrops.map((drop) => Date.parse(drop.createdAt));

    for (const t of created) {
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeLessThanOrEqual(now);
      expect(now - t).toBeLessThanOrEqual(sixHoursMs);
    }
    expect([...created].sort((a, b) => b - a)).toEqual(created);
  });

  it("seeds ride the single in-memory read path (no second render path)", () => {
    // Unscoped defaults to London — Manchester seeds stay off the London feed.
    const all = listAllVisiblePintDrops();
    for (const drop of londonDemoPintDrops) {
      expect(all.some((d) => d.id === drop.id)).toBe(true);
    }
    for (const drop of manchesterDemoPintDrops) {
      expect(all.some((d) => d.id === drop.id)).toBe(false);
    }
    const first = londonDemoPintDrops[0];
    expect(listVisiblePintDrops(first.venueId)).toContainEqual(first);
    expect(demoDropsFor(first.venueId)).toContainEqual(first);
    expect(demoDropsFor("venue-nope")).toEqual([]);
  });

  it("city-scoped unscoped reads keep Manchester seeds off London and vice versa", () => {
    expect(demoPintDropsForCity("london")).toEqual(londonDemoPintDrops);
    expect(demoPintDropsForCity(undefined)).toEqual(londonDemoPintDrops);
    expect(demoPintDropsForCity("manchester")).toEqual(manchesterDemoPintDrops);

    const londonFeed = listAllVisiblePintDrops("london");
    const mcrFeed = listAllVisiblePintDrops("manchester");
    expect(londonFeed.every((d) => !d.venueId.startsWith("venue-mcr-"))).toBe(true);
    expect(mcrFeed.every((d) => d.venueId.startsWith("venue-mcr-"))).toBe(true);
    expect(mcrFeed.length).toBe(manchesterDemoPintDrops.length);
  });
});
