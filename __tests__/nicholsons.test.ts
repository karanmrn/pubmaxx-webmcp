import { describe, it, expect } from "vitest";

import {
  matchNicholsonVenue,
  nicholsonIdentityFromSlug,
  nicholsonSlugFromUrl,
  nicholsonSlugLocality,
  nicholsonSlugToName,
  type NicholsonDatasetVenue,
  type NicholsonPubIdentity,
} from "@/lib/nicholsons";

// Pure identity + conservative-matching helpers for Nicholson's pubs. No
// network. Cases below reflect the module's ACTUAL current behaviour (curated
// map first, suffix stripping, jaccard name match gated on locality/London).

describe("nicholsonSlugToName", () => {
  const cases: Array<[string, string]> = [
    // Curated map wins (and is trim/case-insensitive on the key).
    ["thedogandducksoholondon", "The Dog and Duck"],
    ["  THEDOGANDDUCKSOHOLONDON  ", "The Dog and Duck"],
    ["theargyllarmsoxfordcircuslondon", "The Argyll Arms"],
    // Non-curated slug: strip "london" + a known locality suffix, then title-case.
    ["thecrownsoholondon", "The Crown"],
    // Empty in → empty out.
    ["", ""],
  ];
  for (const [slug, expected] of cases) {
    it(`${JSON.stringify(slug)} → ${JSON.stringify(expected)}`, () => {
      expect(nicholsonSlugToName(slug)).toBe(expected);
    });
  }
});

describe("nicholsonSlugLocality", () => {
  const cases: Array<[string, string]> = [
    ["thedogandducksoholondon", "soho"],
    ["theargyllarmsoxfordcircuslondon", "oxfordcircus"],
    ["theblackfriarblackfriarslondon", "blackfriars"],
    // No known suffix → empty.
    ["randomslug", ""],
  ];
  for (const [slug, expected] of cases) {
    it(`${JSON.stringify(slug)} → ${JSON.stringify(expected)}`, () => {
      expect(nicholsonSlugLocality(slug)).toBe(expected);
    });
  }
});

describe("nicholsonIdentityFromSlug", () => {
  it("builds the canonical URL family + name + locality from a slug", () => {
    const id = nicholsonIdentityFromSlug("/thedogandducksoholondon/");
    const base = "https://www.nicholsonspubs.co.uk/restaurants/london/thedogandducksoholondon";
    expect(id).toEqual({
      slug: "thedogandducksoholondon",
      name: "The Dog and Duck",
      baseUrl: base,
      foodmenuUrl: `${base}/foodmenu`,
      bookingsUrl: `${base}/bookings`,
      drinksUrl: `${base}/drinks`,
      localityHint: "soho",
    });
  });
});

describe("nicholsonSlugFromUrl", () => {
  it("extracts a lowercased slug from a nicholsonspubs restaurant URL", () => {
    expect(
      nicholsonSlugFromUrl(
        "https://www.nicholsonspubs.co.uk/restaurants/london/thedogandducksoholondon/foodmenu",
      ),
    ).toBe("thedogandducksoholondon");
  });

  it("lowercases a mixed-case slug", () => {
    expect(
      nicholsonSlugFromUrl("https://www.nicholsonspubs.co.uk/restaurants/london/TheDogAndDuck"),
    ).toBe("thedogandduck");
  });

  it("returns null for a non-nicholsons host", () => {
    expect(nicholsonSlugFromUrl("https://example.com/restaurants/london/foo")).toBeNull();
  });

  it("returns null for a nicholsons URL without a restaurant slug", () => {
    expect(nicholsonSlugFromUrl("https://www.nicholsonspubs.co.uk/about")).toBeNull();
  });

  it("returns null for an unparseable URL", () => {
    expect(nicholsonSlugFromUrl("not a url")).toBeNull();
  });
});

describe("matchNicholsonVenue", () => {
  it("matches by website when it carries the slug (score 1, method website)", () => {
    const identity = nicholsonIdentityFromSlug("thedogandducksoholondon");
    const dataset: NicholsonDatasetVenue[] = [
      {
        venueKey: "k1",
        venueId: "v1",
        name: "The Dog and Duck",
        address: "18 Bateman St, Soho, London W1D 3AJ",
        website:
          "https://www.nicholsonspubs.co.uk/restaurants/london/thedogandducksoholondon",
      },
    ];
    const match = matchNicholsonVenue(identity, dataset);
    expect(match).toEqual({
      venueKey: "k1",
      venueId: "v1",
      score: 1,
      matchedName: "The Dog and Duck",
      method: "website",
    });
  });

  it("refuses ambiguous website hits that resolve to different keys", () => {
    const identity = nicholsonIdentityFromSlug("thedogandducksoholondon");
    const dataset: NicholsonDatasetVenue[] = [
      {
        venueKey: "k1",
        venueId: "v1",
        name: "The Dog and Duck",
        address: "18 Bateman St, Soho, London W1D 3AJ",
        website: "https://www.nicholsonspubs.co.uk/london/thedogandducksoholondon",
      },
      {
        venueKey: "k2",
        venueId: "v2",
        name: "Dog & Duck (dup)",
        address: "Somewhere else, London",
        website: "https://www.nicholsonspubs.co.uk/london/thedogandducksoholondon",
      },
    ];
    expect(matchNicholsonVenue(identity, dataset)).toBeNull();
  });

  it("falls back to a fuzzy name match when locality appears in the address", () => {
    const identity = nicholsonIdentityFromSlug("theblackfriarblackfriarslondon");
    const dataset: NicholsonDatasetVenue[] = [
      {
        venueKey: "k3",
        venueId: "v3",
        name: "The Blackfriar",
        address: "174 Queen Victoria St, Blackfriars, London EC4V 4EG",
      },
    ];
    const match = matchNicholsonVenue(identity, dataset);
    expect(match?.venueId).toBe("v3");
    expect(match?.method).toBe("fuzzy-name");
    expect(match?.score).toBe(1);
  });

  it("honours the minScore threshold (partial overlap below vs. at the floor)", () => {
    const identity = nicholsonIdentityFromSlug("thedogandducksoholondon");
    const dataset: NicholsonDatasetVenue[] = [
      {
        venueKey: "k4",
        venueId: "v4",
        // tokens {dog, and, fox} vs {dog, and, duck} → jaccard 0.5.
        name: "Dog and Fox",
        address: "1 High St, Soho, London W1",
      },
    ];
    // Default floor 0.6 rejects the 0.5 overlap.
    expect(matchNicholsonVenue(identity, dataset)).toBeNull();
    // Lowering the floor to 0.5 lets the same row through.
    const match = matchNicholsonVenue(identity, dataset, 0.5);
    expect(match?.venueId).toBe("v4");
    expect(match?.method).toBe("fuzzy-name");
  });

  it("refuses a short single-word name with no locality as too ambiguous", () => {
    const identity: NicholsonPubIdentity = {
      slug: "thecrown",
      name: "The Crown",
      baseUrl: "",
      foodmenuUrl: "",
      bookingsUrl: "",
      drinksUrl: "",
      localityHint: "",
    };
    const dataset: NicholsonDatasetVenue[] = [
      { venueKey: "k5", venueId: "v5", name: "The Crown", address: "London" },
    ];
    expect(matchNicholsonVenue(identity, dataset)).toBeNull();
  });

  it("returns null against an empty dataset", () => {
    const identity = nicholsonIdentityFromSlug("thedogandducksoholondon");
    expect(matchNicholsonVenue(identity, [])).toBeNull();
  });
});
