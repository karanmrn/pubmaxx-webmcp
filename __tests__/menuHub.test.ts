import { describe, expect, it } from "vitest";

import { menuHubTiles } from "@/lib/menuHub";
import type { Drink } from "@/lib/drinks";
import type { Venue } from "@/lib/venues";

function venue(over: Partial<Venue> = {}): Venue {
  return {
    id: "venue-test",
    name: "The Test Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: 5.5,
    cheapestPint: "Lager",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...over,
  };
}

function drink(over: Partial<Drink> & Pick<Drink, "id" | "category" | "name">): Drink {
  return {
    priceGbp: 5,
    provenance: { source: "seed", licence: "n/a", observedAt: "2026-01-01T00:00:00Z" },
    ...over,
  };
}

describe("menuHubTiles", () => {
  it("puts Drinks first when any drinks exist", () => {
    const tiles = menuHubTiles(venue(), [
      drink({ id: "d1", category: "beer", name: "Lager" }),
    ]);
    expect(tiles[0]).toMatchObject({ kind: "drinks", label: "Drinks" });
    // Single category → no per-family echo tiles
    expect(tiles.some((t) => t.kind === "drink-category")).toBe(false);
  });

  it("adds category tiles when more than one family is present", () => {
    const tiles = menuHubTiles(venue(), [
      drink({ id: "d1", category: "beer", name: "Lager" }),
      drink({ id: "d2", category: "gin", name: "Gin" }),
    ]);
    expect(tiles.map((t) => t.kind)).toEqual([
      "drinks",
      "drink-category",
      "drink-category",
    ]);
  });

  it("adds a Food menu external tile only when food + website exist", () => {
    const withFood = menuHubTiles(
      venue({
        website: "https://pub.example/menu",
        amenities: { ...venue().amenities, food: true },
      }),
      [drink({ id: "d1", category: "beer", name: "Lager" })],
    );
    expect(withFood.some((t) => t.kind === "food-external")).toBe(true);

    const noFood = menuHubTiles(
      venue({ website: "https://pub.example/" }),
      [drink({ id: "d1", category: "beer", name: "Lager" })],
    );
    expect(noFood.some((t) => t.kind === "food-external")).toBe(false);
  });

  it("adds a Food menu tile from curated menuUrl even without food amenity", () => {
    const tiles = menuHubTiles(
      venue({ menuUrl: "https://pub.example/menu" }),
      [drink({ id: "d1", category: "beer", name: "Lager" })],
    );
    expect(tiles.some((t) => t.kind === "food-external")).toBe(true);
  });

  it("does not emit an HTTP food CTA", () => {
    const tiles = menuHubTiles(venue({ menuUrl: "http://pub.example/menu" }), []);
    expect(tiles.some((tile) => tile.kind === "food-external")).toBe(false);
  });

  it("labels a late-food external menu without calling it a pub site", () => {
    const tiles = menuHubTiles(
      venue({
        kind: "food",
        menuUrl: "https://food.example/menu",
      }),
      [],
    );

    expect(tiles).toContainEqual({
      id: "food-external",
      kind: "food-external",
      label: "Food menu",
      hint: "Opens the late-food venue site",
      href: "https://food.example/menu",
    });
  });

  it("returns empty when there are no drinks and no food link", () => {
    expect(menuHubTiles(venue(), [])).toEqual([]);
  });

  it("emits categoryTiles with imageUrl as food-external tiles", () => {
    const tiles = menuHubTiles(
      venue({
        website: "https://pub.example/",
        menuUrl: "https://pub.example/menu",
        amenities: { ...venue().amenities, food: true },
        categoryTiles: [
          {
            id: "roasts",
            label: "Sunday roast",
            hint: "Opens the pub site",
            imageUrl: "https://cdn.example/roast.jpg",
          },
        ],
      }),
      [drink({ id: "d1", category: "beer", name: "Lager" })],
    );
    const food = tiles.filter((t) => t.kind === "food-external");
    expect(food).toHaveLength(1);
    expect(food[0]).toMatchObject({
      id: "roasts",
      label: "Sunday roast",
      href: "https://pub.example/menu",
      imageUrl: "https://cdn.example/roast.jpg",
    });
  });
});
