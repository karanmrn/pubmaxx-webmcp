import { describe, expect, it } from "vitest";

import {
  resolveBookingAction,
  venueBookingAction,
  venueExternalActions,
} from "@/lib/venueExternalActions";
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
  } as Venue;
}

describe("resolveBookingAction", () => {
  it("prefers a direct bookingUrl (tier: direct)", () => {
    const resolved = resolveBookingAction({
      name: "The Test Arms",
      bookingUrl: "https://book.example/table",
    });
    expect(resolved).toEqual({
      href: "https://book.example/table",
      label: "Book a table",
      tier: "direct",
    });
  });

  it("falls back to the venue website when there is no booking URL (tier: site)", () => {
    const resolved = resolveBookingAction({
      name: "The Test Arms",
      websiteUrl: "https://thetestarms.example/",
    });
    expect(resolved).toEqual({
      href: "https://thetestarms.example/",
      label: "Book via site",
      tier: "site",
    });
  });

  it("derives a site link from the menuUrl domain when there is no website field", () => {
    const resolved = resolveBookingAction({
      name: "The Test Arms",
      menuUrl: "https://thetestarms.example/food/sunday-roast",
    });
    expect(resolved).toEqual({
      href: "https://thetestarms.example",
      label: "Book via site",
      tier: "site",
    });
  });

  it("never derives a site link from an invalid bookingUrl (falls to search)", () => {
    const resolved = resolveBookingAction({
      name: "The Test Arms",
      bookingUrl: "mailto:book@thetestarms.example",
    });
    expect(resolved.tier).toBe("search");
  });

  it("falls back to an honest Google Maps search when nothing bookable is known (tier: search)", () => {
    const resolved = resolveBookingAction({
      name: "The Test Arms",
      areaHint: "N1 2AB",
    });
    expect(resolved.tier).toBe("search");
    expect(resolved.label).toBe("Find booking");
    expect(resolved.href).toBe(
      "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent("The Test Arms N1 2AB book a table"),
    );
  });

  it("never returns a non-https href, even for the search fallback", () => {
    const resolved = resolveBookingAction({ name: "The Test Arms" });
    expect(resolved.href.startsWith("https://")).toBe(true);
  });

  it("rejects javascript: booking and website URLs and still resolves safely", () => {
    const resolved = resolveBookingAction({
      name: "The Test Arms",
      bookingUrl: "javascript:alert(1)",
      websiteUrl: "javascript:alert(1)",
    });
    expect(resolved.tier).toBe("search");
  });

  it("omits a missing areaHint gracefully from the search query", () => {
    const resolved = resolveBookingAction({ name: "The Test Arms" });
    expect(resolved.href).toBe(
      "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent("The Test Arms book a table"),
    );
  });
});

describe("venueBookingAction", () => {
  it("prefers bookingLink, then website, then falls back to search", () => {
    expect(
      venueBookingAction(venue({ bookingLink: "https://book.example/table" })).tier,
    ).toBe("direct");
    expect(venueBookingAction(venue({ website: "https://pub.example/" })).tier).toBe(
      "site",
    );
    expect(venueBookingAction(venue()).tier).toBe("search");
  });

  it("falls back to primaryBorough for the search query when address is blank", () => {
    const resolved = venueBookingAction(venue({ address: "" }));
    const query = decodeURIComponent(resolved.href.split("query=")[1] ?? "");
    expect(query).toContain("Camden");
  });
});

describe("venueExternalActions", () => {
  it("always includes a book action, even with no booking/website data (search tier)", () => {
    const actions = venueExternalActions(venue());
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "book",
      label: "Find booking",
      tier: "search",
    });
    expect(actions[0].href).toContain("https://www.google.com/maps/search");
  });

  it("surfaces Book a table when bookingLink is http(s)", () => {
    const actions = venueExternalActions(
      venue({ bookingLink: "https://book.example/table" }),
    );
    expect(actions).toEqual([
      {
        kind: "book",
        label: "Book a table",
        href: "https://book.example/table",
        tier: "direct",
      },
    ]);
  });

  it("labels website as Look at the menu when the pub serves food", () => {
    const actions = venueExternalActions(
      venue({
        website: "https://pub.example/menu",
        amenities: { ...venue().amenities, food: true },
      }),
    );
    expect(actions).toEqual([
      {
        kind: "book",
        label: "Book via site",
        href: "https://pub.example/menu",
        tier: "site",
      },
      {
        kind: "menu",
        label: "Look at the menu",
        href: "https://pub.example/menu",
      },
    ]);
  });

  it("labels website as Pub website when food is not flagged", () => {
    const actions = venueExternalActions(
      venue({ website: "https://pub.example/" }),
    );
    expect(actions.find((a) => a.kind === "website")).toMatchObject({
      kind: "website",
      label: "Pub website",
    });
  });

  it.each([
    ["bar", "Bar website"],
    ["food", "Late-food venue website"],
    ["club", "Venue website"],
    ["restaurant", "Venue website"],
  ] as const)("labels a %s website without calling it a pub", (kind, label) => {
    const actions = venueExternalActions(
      venue({ kind, website: `https://${kind}.example/` }),
    );

    expect(actions.find((action) => action.kind === "website")).toMatchObject({
      kind: "website",
      label,
    });
  });

  it("falls back to search tier for non-http booking links (never a dead/unsafe href)", () => {
    const actions = venueExternalActions(venue({ bookingLink: "javascript:alert(1)" }));
    expect(actions[0]).toMatchObject({ kind: "book", tier: "search" });
  });

  it("falls back to search tier for email/whitespace booking links", () => {
    expect(
      venueExternalActions(venue({ bookingLink: "bookings@pub.example" }))[0],
    ).toMatchObject({ kind: "book", tier: "search" });
    expect(
      venueExternalActions(venue({ bookingLink: "   " }))[0],
    ).toMatchObject({ kind: "book", tier: "search" });
  });

  it("rejects non-http websites (no website/menu action, book still falls back to search)", () => {
    expect(
      venueExternalActions(venue({ website: "javascript:alert(1)" })).map((a) => a.kind),
    ).toEqual(["book"]);
    expect(
      venueExternalActions(venue({ website: "not-a-url" })).map((a) => a.kind),
    ).toEqual(["book"]);
  });

  it("rejects http website and menu CTAs", () => {
    const actions = venueExternalActions(
      venue({ website: "http://pub.example/", menuUrl: "http://pub.example/menu" }),
    );
    expect(actions.map((action) => action.kind)).toEqual(["book"]);
  });

  it("does not invent a menu action when food is flagged but website is empty", () => {
    expect(
      venueExternalActions(
        venue({ amenities: { ...venue().amenities, food: true } }),
      ).map((a) => a.kind),
    ).toEqual(["book"]);
  });

  it("never invents an order action without orderUrl", () => {
    const actions = venueExternalActions(
      venue({
        bookingLink: "https://book.example/table",
        website: "https://pub.example/menu",
        amenities: { ...venue().amenities, food: true },
      }),
    );
    expect(actions.map((a) => a.kind)).not.toContain("order");
  });

  it("prefers menuUrl over website for Look at the menu when food", () => {
    const actions = venueExternalActions(
      venue({
        website: "https://pub.example/",
        menuUrl: "https://pub.example/food-menu",
        amenities: { ...venue().amenities, food: true },
      }),
    );
    expect(actions.find((a) => a.kind === "menu")).toEqual({
      kind: "menu",
      label: "Look at the menu",
      href: "https://pub.example/food-menu",
    });
  });

  it("surfaces curated menuUrl even when food amenity is false", () => {
    const actions = venueExternalActions(
      venue({
        website: "https://pub.example/",
        menuUrl: "https://pub.example/food-menu",
      }),
    );
    expect(actions.find((a) => a.kind === "menu")).toMatchObject({
      kind: "menu",
      label: "Look at the menu",
      href: "https://pub.example/food-menu",
    });
  });

  it("emits Order food when orderUrl is http(s)", () => {
    const actions = venueExternalActions(
      venue({
        website: "https://pub.example/",
        orderUrl: "https://order.example/pub",
        amenities: { ...venue().amenities, food: true },
      }),
    );
    expect(actions.map((a) => a.kind)).toEqual(["book", "menu", "order"]);
    expect(actions.find((a) => a.kind === "order")).toEqual({
      kind: "order",
      label: "Order food",
      href: "https://order.example/pub",
    });
  });
});
