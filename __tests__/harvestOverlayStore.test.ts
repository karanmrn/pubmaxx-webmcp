import { afterEach, describe, expect, it } from "vitest";

import { parseOverlayRow } from "@/lib/harvestFold";
import {
  __resetHarvestOverlayStore,
  harvestOverlayStore,
} from "@/lib/harvestOverlayStore";

const row = parseOverlayRow({
  osmId: "node/123",
  name: "The Red Lion",
  town: "Clapham",
  website: "https://redlion.example/",
  menuUrl: "https://redlion.example/menu",
  matchedLore: {
    text: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
    citations: ["https://history.example/red-lion-clapham"],
  },
  sources: ["https://redlion.example/"],
});

afterEach(() => {
  __resetHarvestOverlayStore();
});

describe("harvestOverlayStore", () => {
  it("requires durable configuration when explicitly requested", () => {
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => harvestOverlayStore({ requireDurable: true })).toThrow(
        "Supabase is required",
      );
    } finally {
      if (originalUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = originalUrl;
      if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });

  it("upserts by OSM id and reads back through every salted venue id", async () => {
    const outcome = await harvestOverlayStore().upsertMany([row]);
    expect(outcome.written).toBe(1);
    expect(outcome.failed).toBeUndefined();

    for (const id of ["node/123", "n123", "venue-uk-n123", "venue-osm-n123"]) {
      const found = await harvestOverlayStore().getByVenueId(id);
      expect(found.status).toBe("ready");
      if (found.status !== "ready") return;
      expect(found.overlay?.osmId).toBe("node/123");
      expect(found.overlay?.website).toBe("https://redlion.example/");
      expect(found.overlay?.matchedLore?.citations[0]).toBe(
        "https://history.example/red-lion-clapham",
      );
    }
  });

  it("treats a miss as unknown, never no-history, and ignores a name", async () => {
    await harvestOverlayStore().upsertMany([row]);
    expect(await harvestOverlayStore().getByVenueId("venue-7l4pei")).toEqual({
      status: "ready",
      overlay: null,
    });
    expect(await harvestOverlayStore().getByVenueId("The Red Lion")).toEqual({
      status: "ready",
      overlay: null,
    });
  });

  it("is idempotent: a second upsert of the same OSM id replaces the row", async () => {
    await harvestOverlayStore().upsertMany([row]);
    const updated = parseOverlayRow({
      osmId: "node/123",
      name: "The Red Lion",
      town: "Clapham",
      website: "https://redlion.example/new",
      menuUrl: null,
      matchedLore: null,
      sources: ["https://redlion.example/new"],
    });
    await harvestOverlayStore().upsertMany([updated]);
    const found = await harvestOverlayStore().getByVenueId("venue-uk-n123");
    expect(found.status).toBe("ready");
    if (found.status !== "ready") return;
    expect(found.overlay?.website).toBe("https://redlion.example/new");
    expect(found.overlay?.matchedLore).toBeNull();
  });
});
