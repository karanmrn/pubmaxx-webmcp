import { afterEach, describe, expect, it, vi } from "vitest";

import { __setUkNationalPubSearchIndexForTests } from "@/lib/ukNationalPubSearch.server";

afterEach(() => {
  __setUkNationalPubSearchIndexForTests(null);
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GET /api/map-search", () => {
  it("returns intent and national pub hits", async () => {
    __setUkNationalPubSearchIndexForTests({
      pubs: [
        ["w9", "Philharmonic Dining Rooms", "Liverpool", 53.4, -2.97],
        ["n1", "The Crown", "Hackney", 51.54, -0.05],
      ],
    });
    vi.doMock("@/lib/mapSearchEvents.server", () => ({
      recordMapSearchEvent: vi.fn(async () => undefined),
    }));
    vi.doMock("@/lib/pintDrops", async () => {
      const actual = await vi.importActual<typeof import("@/lib/pintDrops")>(
        "@/lib/pintDrops",
      );
      return { ...actual, isLimited: vi.fn(async () => false) };
    });
    const { GET } = await import("@/app/api/map-search/route");
    const response = await GET(
      new Request("http://localhost/api/map-search?q=Philharmonic"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.intent.primary).toBeTruthy();
    expect(body.nationalPubs.some((hit: { name: string }) =>
      hit.name.includes("Philharmonic"),
    )).toBe(true);
    expect(body.nationalStatus).toBe("ready");
  });
});
