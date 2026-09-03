import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import { GET } from "@/app/api/harvest-overlay/route";
import { parseOverlayRow } from "@/lib/harvestFold";
import { __resetHarvestOverlayStore, harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/harvest-overlay?${query}`));
}

beforeEach(() => {
  __resetHarvestOverlayStore();
  __resetPintDrops();
});

describe("GET /api/harvest-overlay", () => {
  it("returns 400 when venueId is missing", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("answers ready with overlay null for an unknown OSM id, never no-history", async () => {
    const res = await get("venueId=venue-uk-n999");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ready", overlay: null });
  });

  it("returns https website, menu, and cited web lore for a folded OSM id", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
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
      }),
    ]);
    const res = await get("venueId=venue-uk-n123");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.overlay.website).toBe("https://redlion.example/");
    expect(body.overlay.menuUrl).toBe("https://redlion.example/menu");
    expect(body.overlay.lore).toEqual({
      source: "web",
      fact: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
      sourceRef: "https://history.example/red-lion-clapham",
    });
    expect(JSON.stringify(body)).not.toMatch(/instagram|social/i);
  });

  it("resolves a salted city id before reading its OSM overlay", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "way/100646638",
        name: "Peveril of the Peak",
        town: "Manchester",
        matchedLore: {
          text: "Peveril of the Peak in Manchester has a long history.",
          citations: ["https://history.example/peveril"],
        },
        sources: ["https://history.example/peveril"],
      }),
    ]);

    const res = await get("venueId=venue-mcr-1lwo5lo");
    expect(res.status).toBe(200);
    expect((await res.json()).overlay.lore.source).toBe("web");
  });

  it("merges overlays from every OSM object owned by one curated venue", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/13235500301",
        name: "The Grenadier",
        town: "London",
        website: "https://grenadier.example/",
        menuUrl: null,
        matchedLore: null,
        sources: ["https://grenadier.example/"],
      }),
      parseOverlayRow({
        osmId: "way/556177108",
        name: "The Grenadier",
        town: "London",
        website: null,
        menuUrl: "https://grenadier.example/menu",
        matchedLore: null,
        sources: ["https://grenadier.example/menu"],
      }),
    ]);

    const res = await get("venueId=venue-1ha28jc");
    expect(res.status).toBe(200);
    expect((await res.json()).overlay).toMatchObject({
      website: "https://grenadier.example/",
      menuUrl: "https://grenadier.example/menu",
    });
  });

  it("returns unknown when stored overlay fields have no public value", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        website: "https://redlion.example/, https://redlion.example/alt",
        menuUrl: null,
        matchedLore: null,
        sources: ["https://redlion.example/"],
      }),
    ]);

    const res = await get("venueId=venue-uk-n123");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", overlay: null });
  });
});
