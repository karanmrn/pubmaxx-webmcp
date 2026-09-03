import { describe, expect, it } from "vitest";

import {
  searchUkBasePubsByName,
  SUGGEST_UK_BASE_PUB_LIMIT,
  UK_BASE_SEARCH_GROUP_LABEL,
} from "@/lib/ukBasePubSearch";
import type { UkBasePub } from "@/lib/ukBasePubs";

function basePub(overrides: Partial<UkBasePub> & { id: string; name: string }): UkBasePub {
  return {
    address: "",
    lat: 53.38,
    lng: -1.47,
    curatedVenueId: "",
    ...overrides,
  };
}

const SHEFFIELD_CENTRE: [number, number] = [-1.47, 53.38];

describe("searchUkBasePubsByName — resident shards only", () => {
  it("returns nothing for an empty or whitespace query", () => {
    const pubs = [basePub({ id: "venue-uk-n1", name: "The Fat Cat" })];
    expect(
      searchUkBasePubsByName({
        pubs,
        query: "",
        userLocation: null,
        mapCenter: SHEFFIELD_CENTRE,
      }),
    ).toEqual([]);
    expect(
      searchUkBasePubsByName({
        pubs,
        query: "   ",
        userLocation: null,
        mapCenter: SHEFFIELD_CENTRE,
      }),
    ).toEqual([]);
  });

  it("returns nothing when no resident pubs are loaded", () => {
    expect(
      searchUkBasePubsByName({
        pubs: [],
        query: "fat cat",
        userLocation: null,
        mapCenter: SHEFFIELD_CENTRE,
      }),
    ).toEqual([]);
  });

  it("matches a resident pub by normalised name and keeps the whole record", () => {
    const fatCat = basePub({
      id: "venue-uk-n-fat",
      name: "The Fat Cat",
      address: "23 Alma Street",
      lat: 53.391,
      lng: -1.477,
    });
    const result = searchUkBasePubsByName({
      pubs: [
        fatCat,
        basePub({ id: "venue-uk-n-other", name: "The Bath Hotel" }),
      ],
      query: "  FAT   cat ",
      userLocation: null,
      mapCenter: SHEFFIELD_CENTRE,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "venue-uk-n-fat",
      name: "The Fat Cat",
      address: "23 Alma Street",
      pub: fatCat,
    });
    expect(result[0].distanceLabel).toContain("from centre");
  });

  it("ranks prefix matches ahead of substring matches, then nearest", () => {
    // "Ahead Arms" only hits via includes (tier 2); the Head* names start a
    // word (tier 1). Nearest wins inside a tier.
    const result = searchUkBasePubsByName({
      pubs: [
        basePub({
          id: "venue-uk-n-sub",
          name: "Ahead Arms",
          lat: 53.38,
          lng: -1.47,
        }),
        basePub({
          id: "venue-uk-n-far-prefix",
          name: "Head of Steam",
          lat: 53.5,
          lng: -1.6,
        }),
        basePub({
          id: "venue-uk-n-near-prefix",
          name: "Head of the River",
          lat: 53.381,
          lng: -1.471,
        }),
      ],
      query: "head",
      userLocation: null,
      mapCenter: SHEFFIELD_CENTRE,
    });
    expect(result.map((row) => row.id)).toEqual([
      "venue-uk-n-near-prefix",
      "venue-uk-n-far-prefix",
      "venue-uk-n-sub",
    ]);
  });

  it("caps the group for phone performance", () => {
    const pubs = Array.from({ length: 20 }, (_, i) =>
      basePub({
        id: `venue-uk-n-${i}`,
        name: `The Crown ${i}`,
        lat: 53.38 + i * 0.001,
        lng: -1.47,
      }),
    );
    const result = searchUkBasePubsByName({
      pubs,
      query: "crown",
      userLocation: null,
      mapCenter: SHEFFIELD_CENTRE,
    });
    expect(result).toHaveLength(SUGGEST_UK_BASE_PUB_LIMIT);
    expect(SUGGEST_UK_BASE_PUB_LIMIT).toBe(8);
  });

  it("labels distance from the viewer when GPS is present", () => {
    const result = searchUkBasePubsByName({
      pubs: [
        basePub({
          id: "venue-uk-n-near",
          name: "The Local",
          lat: 53.381,
          lng: -1.47,
        }),
      ],
      query: "local",
      userLocation: { lat: 53.38, lng: -1.47 },
      mapCenter: SHEFFIELD_CENTRE,
    });
    expect(result[0].distanceLabel).toContain("away");
  });

  it("dedupes by id and never invents a single-character substring flood", () => {
    const pubs = [
      basePub({ id: "venue-uk-n1", name: "The Anchor" }),
      basePub({ id: "venue-uk-n1", name: "The Anchor" }),
      basePub({ id: "venue-uk-n2", name: "Bath Hotel" }),
    ];
    expect(
      searchUkBasePubsByName({
        pubs,
        query: "a",
        userLocation: null,
        mapCenter: SHEFFIELD_CENTRE,
      }).map((row) => row.id),
    ).toEqual(["venue-uk-n1"]);
  });

  it("ships the group label the suggest panel prints", () => {
    expect(UK_BASE_SEARCH_GROUP_LABEL).toBe("Pubs on the map");
  });
});
