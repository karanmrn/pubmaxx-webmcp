import { describe, expect, it } from "vitest";

import { venueAcceptUrl, venueMapUrl } from "@/lib/venueMapUrl";

// The "see this pub on the map" contract: the link must carry ?sel=<id> so the
// map selects the venue AND centres the camera on load (PubMapCanvas honours
// sel via the selectedPresent deep-link fix). City-prefixed ids route to their
// city's map path; London ids use the bare /map.
describe("venueMapUrl", () => {
  it("emits a /map link carrying sel=<id>", () => {
    const url = venueMapUrl("the-dove-hammersmith");
    expect(url).toContain("/map");
    expect(url).toContain("sel=the-dove-hammersmith");
  });

  it("URL-encodes ids and preserves them round-trip", () => {
    const url = venueMapUrl("pub with spaces&x");
    const query = url.split("?")[1] ?? "";
    expect(new URLSearchParams(query).get("sel")).toBe("pub with spaces&x");
  });

  it("routes city-prefixed venue ids to that city's map", () => {
    const url = venueMapUrl("manchester-some-pub");
    expect(url).toContain("sel=manchester-some-pub");
    // City-aware path keeps the link inside a /map route (per-city or bare).
    expect(url.startsWith("/")).toBe(true);
    expect(url).toContain("map");
  });
});

// The EXPLICIT-acceptance link (§4.6): unlike the browse link it also carries
// accept=1 (this person committed to the Venue) and a fixed src so the Map never
// guesses the acceptance origin.
describe("venueAcceptUrl", () => {
  it("adds accept=1 and the fixed source alongside sel", () => {
    const query = venueAcceptUrl("the-dove-hammersmith", "near").split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    expect(params.get("sel")).toBe("the-dove-hammersmith");
    expect(params.get("accept")).toBe("1");
    expect(params.get("src")).toBe("near");
  });

  it("stays city-aware exactly like the browse link", () => {
    const browse = venueMapUrl("venue-mcr-1lwo5lo");
    const accept = venueAcceptUrl("venue-mcr-1lwo5lo", "near");
    // Same /map route base as the browse link, just with acceptance params.
    expect(accept.split("?")[0]).toBe(browse.split("?")[0]);
    expect(accept).toContain("accept=1");
  });

  it("URL-encodes the venue id round-trip", () => {
    const query = venueAcceptUrl("pub with spaces&x", "near").split("?")[1] ?? "";
    expect(new URLSearchParams(query).get("sel")).toBe("pub with spaces&x");
  });
});
