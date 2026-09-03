import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { manchesterDemoPintDrops } from "@/lib/cities/manchester/pintDropSeeds";
import {
  demoDropsFor,
  demoPintDropsForCity,
  manchesterDemoPintDrops as reexported,
} from "@/lib/pintDropSeeds";
import { listAllVisiblePintDrops, listVisiblePintDrops } from "@/lib/pintDrops";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

type SlimRow = { id: string; name: string; cheapestPrice: number | null };

const slimPath = path.join(
  process.cwd(),
  "public",
  "data",
  "cities",
  "manchester",
  "venues_slim.json",
);
const slim = (rowsFromSlimPayload(JSON.parse(readFileSync(slimPath, "utf8"))) ?? []) as SlimRow[];
const slimById = new Map(slim.map((row) => [row.id, row]));

const NORTHERN_MIN = 3.8;
const NORTHERN_MAX = 6.5;

describe("Manchester demo Pint Drop seeds", () => {
  it("seeds at least 8 demo drops for Manchester venues", () => {
    expect(manchesterDemoPintDrops.length).toBeGreaterThanOrEqual(8);
    expect(reexported).toBe(manchesterDemoPintDrops);
  });

  it("every seed venueId exists in the Manchester slim index", () => {
    for (const drop of manchesterDemoPintDrops) {
      expect(drop.venueId.startsWith("venue-mcr-")).toBe(true);
      const venue = slimById.get(drop.venueId);
      expect(venue, `seed ${drop.id} missing from slim: ${drop.venueId}`).toBeDefined();
      expect(venue!.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("every seed is provenance demo, visible, and honestly noted", () => {
    for (const drop of manchesterDemoPintDrops) {
      expect(drop.provenance).toBe("demo");
      expect(drop.status).toBe("visible");
      expect(drop.handle.startsWith("@")).toBe(true);
      expect(drop.passedDownNote).toMatch(/Seeded demo Drop/i);
      expect(drop.id.startsWith("seed-mcr-")).toBe(true);
    }
    expect(new Set(manchesterDemoPintDrops.map((d) => d.id)).size).toBe(
      manchesterDemoPintDrops.length,
    );
  });

  it("prices sit in a plausible Northern £ range", () => {
    for (const drop of manchesterDemoPintDrops) {
      expect(typeof drop.priceGbp).toBe("number");
      expect(drop.priceGbp!).toBeGreaterThanOrEqual(NORTHERN_MIN);
      expect(drop.priceGbp!).toBeLessThanOrEqual(NORTHERN_MAX);
    }
  });

  it("covers the iconic tiled / NQ pubs that exist in slim", () => {
    const names = manchesterDemoPintDrops.map((d) => slimById.get(d.venueId)!.name.toLowerCase());
    expect(names.some((n) => n.includes("peveril"))).toBe(true);
    expect(names.some((n) => n.includes("briton"))).toBe(true);
    expect(names.some((n) => n.includes("circus"))).toBe(true);
    expect(names.some((n) => n.includes("castle hotel"))).toBe(true);
    expect(names.some((n) => n.includes("marble arch"))).toBe(true);
  });

  it("rides the same per-venue read path as London seeds", () => {
    const first = manchesterDemoPintDrops[0];
    expect(demoDropsFor(first.venueId)).toContainEqual(first);
    expect(listVisiblePintDrops(first.venueId)).toContainEqual(first);
  });

  it("appears on Manchester-scoped unscoped reads, not London", () => {
    expect(demoPintDropsForCity("manchester")).toEqual(manchesterDemoPintDrops);
    const mcr = listAllVisiblePintDrops("manchester");
    for (const drop of manchesterDemoPintDrops) {
      expect(mcr.some((d) => d.id === drop.id)).toBe(true);
    }
    const london = listAllVisiblePintDrops("london");
    for (const drop of manchesterDemoPintDrops) {
      expect(london.some((d) => d.id === drop.id)).toBe(false);
    }
  });

  it("does not invent venues — every id is already in slim with null cheapestPrice ok", () => {
    // Guard: we only seed pubs that already exist; we never invent prices into slim.
    for (const drop of manchesterDemoPintDrops) {
      const row = slimById.get(drop.venueId)!;
      expect(row).toBeDefined();
      // Slim may carry null community prices — seeds fill the map layer instead.
      expect(row.cheapestPrice === null || typeof row.cheapestPrice === "number").toBe(true);
    }
  });
});
