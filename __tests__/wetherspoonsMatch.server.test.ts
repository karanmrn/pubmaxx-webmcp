import { describe, expect, it } from "vitest";

import {
  loadWetherspoonsDirectoryPubs,
  matchWetherspoonsDirectoryPub,
  matchedWetherspoonsVenueIds,
  normalizeWetherspoonsMatchName,
} from "@/lib/wetherspoonsMatch.server";

describe("wetherspoons directory match", () => {
  it("normalises Ice Wharf style suffixes and bare Hamilton Hall names the same way", () => {
    expect(normalizeWetherspoonsMatchName("The Ice Wharf - JD Wetherspoon")).toBe("ice wharf");
    expect(normalizeWetherspoonsMatchName("The Ice Wharf")).toBe("ice wharf");
    expect(normalizeWetherspoonsMatchName("Hamilton Hall")).toBe("hamilton hall");
    expect(normalizeWetherspoonsMatchName("The Hamilton Hall")).toBe("hamilton hall");
  });

  it("matches Ice Wharf despite the venue-dataset JD Wetherspoon suffix", async () => {
    const pubs = await loadWetherspoonsDirectoryPubs();
    const match = matchWetherspoonsDirectoryPub(
      {
        name: "The Ice Wharf - JD Wetherspoon",
        lat: 51.5404,
        lng: -0.145649,
      },
      pubs,
    );
    expect(match?.name).toBe("The Ice Wharf");
  });

  it("matches Hamilton Hall when the curated name has no chain suffix", async () => {
    const pubs = await loadWetherspoonsDirectoryPubs();
    const match = matchWetherspoonsDirectoryPub(
      {
        name: "Hamilton Hall",
        lat: 51.517643,
        lng: -0.080963,
      },
      pubs,
    );
    expect(match?.name).toBe("Hamilton Hall");
  });

  it("refuses a same-name hit outside the 250 m window", async () => {
    const pubs = await loadWetherspoonsDirectoryPubs();
    const match = matchWetherspoonsDirectoryPub(
      {
        name: "The Ice Wharf - JD Wetherspoon",
        lat: 51.5,
        lng: -0.1,
      },
      pubs,
    );
    expect(match).toBeNull();
  });

  it("returns only the venue ids that join the directory", async () => {
    const ids = await matchedWetherspoonsVenueIds([
      {
        id: "ice-wharf",
        name: "The Ice Wharf - JD Wetherspoon",
        lat: 51.5404,
        lng: -0.145649,
      },
      {
        id: "indie",
        name: "The Local Arms",
        lat: 51.54,
        lng: -0.14,
      },
    ]);
    expect([...ids]).toEqual(["ice-wharf"]);
  });
});
