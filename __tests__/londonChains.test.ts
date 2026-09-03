import { describe, expect, it } from "vitest";

import {
  matchNicholsonVenue,
  nicholsonIdentityFromSlug,
  nicholsonSlugFromUrl,
  nicholsonSlugToName,
  type NicholsonDatasetVenue,
} from "@/lib/nicholsons";
import {
  matchYoungsVenue,
  parseYoungsGardenMarkdown,
  youngsHostname,
  youngsNameFromHostname,
  type YoungsDatasetVenue,
} from "@/lib/youngs";

describe("nicholsonSlugToName", () => {
  it("maps known London slugs to human pub names", () => {
    expect(nicholsonSlugToName("theblackfriarblackfriarslondon")).toBe("The Blackfriar");
    expect(nicholsonSlugToName("thedogandducksoholondon")).toBe("The Dog and Duck");
    expect(nicholsonSlugToName("doggettscoatandbadgesouthbanklondon")).toBe(
      "Doggett's Coat and Badge",
    );
    expect(nicholsonSlugToName("yeoldewatlingwatlingstreetlondon")).toBe("Ye Olde Watling");
  });

  it("extracts slug from a Nicholson's URL", () => {
    expect(
      nicholsonSlugFromUrl(
        "https://www.nicholsonspubs.co.uk/restaurants/london/thecoalholestrandlondon/foodmenu",
      ),
    ).toBe("thecoalholestrandlondon");
  });
});

describe("matchNicholsonVenue", () => {
  const dataset: NicholsonDatasetVenue[] = [
    {
      venueKey: "the blackfriar|174 queen victoria st|51.51|-0.10",
      venueId: "venue-blackfriar",
      name: "The Blackfriar",
      address: "174 Queen Victoria St, London EC4V 4EG",
      website:
        "https://www.nicholsonspubs.co.uk/restaurants/london/theblackfriarblackfriarslondon",
    },
    {
      venueKey: "crown (covent garden)|43 monmouth street|51.51|-0.12",
      venueId: "venue-gk-crown",
      name: "Crown (Covent Garden)",
      address: "43 Monmouth Street, WC2H 9DD",
      website: "https://www.greeneking.co.uk/pubs/greater-london/crown",
    },
  ];

  it("matches by nicholsonspubs website path", () => {
    const identity = nicholsonIdentityFromSlug("theblackfriarblackfriarslondon");
    const m = matchNicholsonVenue(identity, dataset);
    expect(m?.venueId).toBe("venue-blackfriar");
    expect(m?.method).toBe("website");
  });

  it("refuses ambiguous short names without locality (no Crown false positive)", () => {
    const identity = nicholsonIdentityFromSlug("thecrownbrewerstreetlondon");
    const m = matchNicholsonVenue(identity, dataset);
    expect(m).toBeNull();
  });
});

describe("youngs helpers", () => {
  it("parses garden markdown explore links with nearby names", () => {
    const md = `
The Founder's Arms, Southbank

The Founder's Arms, Southbank

[Explore the pub](https://www.foundersarms.co.uk/)
`;
    const pubs = parseYoungsGardenMarkdown(md, "central.md");
    expect(pubs).toHaveLength(1);
    expect(pubs[0].name).toMatch(/Founder/i);
    expect(youngsHostname(pubs[0].url)).toBe("foundersarms.co.uk");
  });

  it("matches by microsite hostname and refuses weak fuzzy collisions", () => {
    const dataset: YoungsDatasetVenue[] = [
      {
        venueKey: "the eagle|shepherd bush|51.5|-0.2",
        venueId: "venue-eagle",
        name: "The Eagle",
        address: "Shepherd's Bush, London W12",
        website: "https://www.theeaglew12.co.uk/",
      },
      {
        venueKey: "queens head winchmore hill|station road|51.6|-0.1",
        venueId: "venue-queens",
        name: "Queens Head Winchmore Hill",
        address: "41-43 Station Road, Winchmore Hill, London",
        website: "",
      },
    ];
    expect(
      matchYoungsVenue(
        { name: "The Eagle, Shepherd's Bush", url: "https://www.theeaglew12.co.uk" },
        dataset,
      )?.venueId,
    ).toBe("venue-eagle");
    expect(
      matchYoungsVenue(
        { name: "King's Head, Winchmore Hill", url: "https://www.thekingsheadn21.co.uk" },
        dataset,
      ),
    ).toBeNull();
  });

  it("derives a readable fallback name from a hostname", () => {
    expect(youngsNameFromHostname("foundersarms.co.uk").toLowerCase()).toContain("founders");
  });
});
