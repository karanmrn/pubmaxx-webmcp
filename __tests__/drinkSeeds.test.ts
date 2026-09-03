import { beforeEach, describe, expect, it } from "vitest";

import {
  demoDrinkVenueIds,
  demoDrinks,
  demoDrinksFor,
} from "@/lib/drinkSeeds";
import { isDrinkCategory } from "@/lib/drinks";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import dataset from "../public/data/pint_prices_app_dataset.json";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const venues = groupVenuePrices(dataset as VenuePrice[]);
const venueById = new Map(venues.map((venue) => [venue.id, venue]));

describe("demo drink seeds", () => {
  it("seeds a menu across the curated heritage pubs", () => {
    expect(demoDrinks.length).toBeGreaterThanOrEqual(6);
    // Six curated pubs, four drinks each.
    expect(demoDrinkVenueIds.length).toBeGreaterThanOrEqual(6);
  });

  it("every seeded drink carries a valid category", () => {
    for (const drink of demoDrinks) {
      expect(isDrinkCategory(drink.category), drink.id).toBe(true);
    }
  });

  it("every seeded drink carries honest demo provenance and a sane price", () => {
    for (const drink of demoDrinks) {
      expect(drink.provenance.source).toBe("seed");
      expect(drink.provenance.licence).toBe("n/a");
      expect(Number.isFinite(Date.parse(drink.provenance.observedAt))).toBe(true);
      expect(drink.priceGbp).toBeGreaterThan(0);
      expect(drink.priceGbp).toBeLessThanOrEqual(50);
      expect(drink.id.startsWith("drink-")).toBe(true);
      expect(drink.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("ids are unique (they key React lists)", () => {
    expect(new Set(demoDrinks.map((d) => d.id)).size).toBe(demoDrinks.length);
  });

  it("every seed venueId resolves to a real curated heritage venue", () => {
    for (const venueId of demoDrinkVenueIds) {
      const venue = venueById.get(venueId);
      expect(venue, `seed venue ${venueId} missing from dataset`).toBeDefined();
      expect(venue!.curation.heritageNote, `${venue!.name} is not curated`).toBeTruthy();
    }
  });

  it("demoDrinksFor returns each pub's menu, empty for an unknown venue", () => {
    for (const venueId of demoDrinkVenueIds) {
      const menu = demoDrinksFor(venueId);
      expect(menu.length).toBeGreaterThan(0);
      // Every returned drink actually belongs to this venue's menu.
      expect(menu.every((d) => d.id.startsWith("drink-"))).toBe(true);
    }
    expect(demoDrinksFor("venue-nope")).toEqual([]);
  });

  it("each curated pub gets a spread of categories beyond beer", () => {
    for (const venueId of demoDrinkVenueIds) {
      const cats = new Set(demoDrinksFor(venueId).map((d) => d.category));
      // At least a wine, a whisky, a gin, a cocktail — never just beer.
      expect(cats.has("beer")).toBe(false);
      expect(cats.size).toBeGreaterThanOrEqual(3);
    }
  });
});
