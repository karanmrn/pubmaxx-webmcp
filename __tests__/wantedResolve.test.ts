import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/venueIndex", () => ({
  getVenueIndex: async () =>
    new Map([
      [
        "venue-dove",
        {
          id: "venue-dove",
          name: "The Dove",
          borough: "Hammersmith",
          lat: 51.49,
          lng: -0.23,
        },
      ],
      [
        "venue-churchill",
        {
          id: "venue-churchill",
          name: "The Churchill Arms",
          borough: "Kensington",
          lat: 51.5,
          lng: -0.19,
        },
      ],
    ]),
}));

import { __setUkNationalPubSearchIndexForTests } from "@/lib/ukNationalPubSearch.server";
import { resolveWantedPaste } from "@/lib/wantedResolve.server";

beforeEach(() => {
  __setUkNationalPubSearchIndexForTests({
    pubs: [
      ["n111", "The Village Arms", "Somewhere, UK", 51.2, -1.1],
      ["n222", "Dove Cottage Inn", "Elsewhere, UK", 52.1, -0.5],
    ],
  });
});

afterEach(() => {
  __setUkNationalPubSearchIndexForTests(null);
  vi.restoreAllMocks();
});

describe("resolveWantedPaste", () => {
  it("returns curated and uk-base candidates for a name", async () => {
    const result = await resolveWantedPaste("Dove");
    expect(result.status).toBe("ready");
    expect(result.query).toBe("Dove");
    const ids = result.candidates.map((c) => c.venueId);
    expect(ids).toContain("venue-dove");
    expect(ids.some((id) => id.startsWith("venue-uk-"))).toBe(true);
    expect(result.candidates.find((c) => c.venueId === "venue-dove")?.venueKind).toBe(
      "curated",
    );
  });

  it("does not invent candidates for a bare Instagram URL", async () => {
    const result = await resolveWantedPaste("https://www.instagram.com/reel/abc/");
    expect(result.candidates).toEqual([]);
    expect(result.sourceUrl).toContain("instagram.com");
    expect(result.query).toBe("");
  });

  it("returns empty candidates for an unresolvable name", async () => {
    const result = await resolveWantedPaste("zzzzz-no-such-pub-xyzzy");
    expect(result.candidates).toEqual([]);
    expect(result.query.length).toBeGreaterThan(2);
  });
});
