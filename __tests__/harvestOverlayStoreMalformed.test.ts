import { afterEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const client = { from: vi.fn(() => query) };
  return { client, query };
});

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => supabaseMock.client,
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => supabaseMock.client,
}));

import { harvestOverlayStore } from "@/lib/harvestOverlayStore";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("durable harvest overlay reads", () => {
  it("degrades instead of caching a malformed stored row as unknown", async () => {
    supabaseMock.query.maybeSingle.mockResolvedValueOnce({
      data: {
        osm_id: "node/123",
        osm_ref: "n123",
        website: "https://",
        menu_url: null,
        lore_text: null,
        lore_citations: [],
        sources: ["https://redlion.example/"],
        lore_match_name: null,
        lore_match_town: null,
      },
      error: null,
    });

    await expect(harvestOverlayStore().getByVenueId("node/123")).resolves.toEqual({
      status: "degraded",
      overlay: null,
    });
  });

  it("degrades when persisted lore text is empty", async () => {
    supabaseMock.query.maybeSingle.mockResolvedValueOnce({
      data: {
        osm_id: "node/123",
        osm_ref: "n123",
        website: "https://redlion.example/",
        menu_url: null,
        lore_text: "",
        lore_citations: ["https://history.example/red-lion"],
        sources: ["https://redlion.example/"],
        lore_match_name: "The Red Lion",
        lore_match_town: "Clapham",
      },
      error: null,
    });

    await expect(harvestOverlayStore().getByVenueId("node/123")).resolves.toEqual({
      status: "degraded",
      overlay: null,
    });
  });
});
