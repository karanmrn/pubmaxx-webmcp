import { describe, it, expect } from "vitest";

import {
  browseSelectionUrl,
  cleanMapUrl,
  formatSelectionHint,
  isSelectionSentinel,
  parseSelectionHint,
  PUBMAX_SELECTION_SENTINEL,
  refreshSelectionUrl,
  searchHasSelection,
  selectionResolution,
  selectionSentinel,
  selectionSentinelVenueId,
  selectionTransition,
  withSelectionSentinel,
} from "@/lib/mapSelectionHistory";

describe("selection sentinel guards", () => {
  it("recognises a well-formed sentinel", () => {
    const state = selectionSentinel("venue-abc");
    expect(state).toEqual({ pubmaxSelection: PUBMAX_SELECTION_SENTINEL, venueId: "venue-abc" });
    expect(isSelectionSentinel(state)).toBe(true);
    expect(selectionSentinelVenueId(state)).toBe("venue-abc");
  });

  it("rejects null, foreign, and malformed state", () => {
    expect(isSelectionSentinel(null)).toBe(false);
    expect(isSelectionSentinel(undefined)).toBe(false);
    expect(isSelectionSentinel({ pubmaxSelection: 1 })).toBe(false); // missing venueId
    expect(isSelectionSentinel({ pubmaxSelection: 2, venueId: "x" })).toBe(false);
    expect(isSelectionSentinel({ venueId: "x" })).toBe(false);
    expect(selectionSentinelVenueId({ foo: "bar" })).toBeNull();
  });
});

describe("withSelectionSentinel", () => {
  it("merges the sentinel onto existing router state, preserving foreign keys", () => {
    const nextState = { __PRIVATE_NEXTJS_INTERNALS_TREE: { some: "tree" }, key: "abc" };
    const merged = withSelectionSentinel(nextState, "venue-xyz");
    expect(merged.pubmaxSelection).toBe(PUBMAX_SELECTION_SENTINEL);
    expect(merged.venueId).toBe("venue-xyz");
    expect(merged.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual({ some: "tree" });
    expect(merged.key).toBe("abc");
    expect(isSelectionSentinel(merged)).toBe(true);
    expect(selectionSentinelVenueId(merged)).toBe("venue-xyz");
  });

  it("handles a null/non-object base", () => {
    expect(withSelectionSentinel(null, "v1")).toEqual({
      pubmaxSelection: PUBMAX_SELECTION_SENTINEL,
      venueId: "v1",
    });
    expect(isSelectionSentinel(withSelectionSentinel(undefined, "v1"))).toBe(true);
  });
});

describe("searchHasSelection", () => {
  it("is true only when sel is present", () => {
    expect(searchHasSelection("?sel=venue-abc")).toBe(true);
    expect(searchHasSelection("?sel=venue-abc&accept=1&src=near")).toBe(true);
    expect(searchHasSelection("?pubs=a,b&mode=build")).toBe(false);
    expect(searchHasSelection("")).toBe(false);
  });
});

describe("cleanMapUrl", () => {
  it("strips sel/accept/src but preserves owned passthrough params", () => {
    expect(cleanMapUrl("/map", "?sel=v1&accept=1&src=near&pubs=a,b&plan=1")).toBe(
      "/map?pubs=a%2Cb&plan=1",
    );
  });

  it("returns a bare pathname when only selection params were present", () => {
    expect(cleanMapUrl("/map", "?sel=v1&accept=1&src=near")).toBe("/map");
    expect(cleanMapUrl("/map", "")).toBe("/map");
  });

  it("keeps a hash", () => {
    expect(cleanMapUrl("/map", "?sel=v1", "#here")).toBe("/map#here");
  });
});

describe("browseSelectionUrl", () => {
  it("sets sel and drops acceptance markers while keeping owned params", () => {
    // Switching to a browse pin from an accepted arrival must not carry accept/src.
    expect(browseSelectionUrl("/map", "?sel=v1&accept=1&src=near&food=1", "v2")).toBe(
      "/map?sel=v2&food=1",
    );
  });

  it("adds sel to a clean Map preserving other params", () => {
    expect(browseSelectionUrl("/map", "?food=1", "v9")).toBe("/map?food=1&sel=v9");
  });

  it("carries the at= hint for a base selection", () => {
    expect(browseSelectionUrl("/map", "?food=1", "venue-uk-n1", "", "51.5003,-0.2218")).toBe(
      "/map?food=1&sel=venue-uk-n1&at=51.5003%2C-0.2218",
    );
  });

  it("clears a stale at= hint when switching to a hint-less selection", () => {
    // base → curated must never leave the previous pub's coordinates behind.
    expect(browseSelectionUrl("/map", "?sel=venue-uk-n1&at=51.5003,-0.2218", "v2")).toBe(
      "/map?sel=v2",
    );
  });
});

describe("refreshSelectionUrl", () => {
  it("keeps accepted-arrival markers while the same Venue surface refreshes", () => {
    expect(refreshSelectionUrl(
      "/map",
      "?sel=v1&accept=1&src=near&food=1",
      "v1",
    )).toBe("/map?sel=v1&accept=1&src=near&food=1");
  });

  it("still refreshes the base-pub location hint", () => {
    expect(refreshSelectionUrl(
      "/map",
      "?sel=venue-uk-n1&accept=1&src=near",
      "venue-uk-n1",
      "",
      "51.5003,-0.2218",
    )).toBe(
      "/map?sel=venue-uk-n1&accept=1&src=near&at=51.5003%2C-0.2218",
    );
  });
});

describe("selection hint (at=)", () => {
  it("round-trips through format and parse", () => {
    const hint = formatSelectionHint(51.50027, -0.22176);
    expect(hint).toBe("51.5003,-0.2218");
    expect(parseSelectionHint(`?sel=venue-uk-n1&at=${hint}`)).toEqual({
      lat: 51.5003,
      lng: -0.2218,
    });
  });

  it("is null when absent or malformed", () => {
    expect(parseSelectionHint("?sel=venue-uk-n1")).toBeNull();
    expect(parseSelectionHint("?at=")).toBeNull();
    expect(parseSelectionHint("?at=fish")).toBeNull();
    expect(parseSelectionHint("?at=51.5")).toBeNull();
    expect(parseSelectionHint("?at=51.5,x")).toBeNull();
    expect(parseSelectionHint("?at=91,0")).toBeNull();
    expect(parseSelectionHint("?at=0,181")).toBeNull();
  });

  it("is stripped by cleanMapUrl with the other selection params", () => {
    expect(cleanMapUrl("/map", "?sel=venue-uk-n1&at=51.5003,-0.2218&food=1")).toBe("/map?food=1");
  });
});

describe("selectionTransition", () => {
  it("no-ops when the selection is unchanged", () => {
    expect(selectionTransition({ prev: "v1", next: "v1", currentSentinelVenueId: "v1" })).toEqual({
      kind: "none",
    });
    expect(selectionTransition({ prev: "", next: "", currentSentinelVenueId: null })).toEqual({
      kind: "none",
    });
  });

  it("pushes on the first selection from a clean Map", () => {
    expect(selectionTransition({ prev: "", next: "v1", currentSentinelVenueId: null })).toEqual({
      kind: "push",
      venueId: "v1",
    });
  });

  it("replaces when switching Venue while a sentinel is active", () => {
    expect(selectionTransition({ prev: "v1", next: "v2", currentSentinelVenueId: "v1" })).toEqual({
      kind: "replace",
      venueId: "v2",
    });
  });

  it("reconciles a matching sentinel reached through browser Forward", () => {
    expect(selectionTransition({ prev: "", next: "v1", currentSentinelVenueId: "v1" })).toEqual({
      kind: "none",
    });
  });

  it("pops with Back on close when the current entry owns the sentinel", () => {
    expect(selectionTransition({ prev: "v1", next: "", currentSentinelVenueId: "v1" })).toEqual({
      kind: "back",
    });
  });

  it("strips the URL on close when no sentinel is owned", () => {
    expect(selectionTransition({ prev: "v1", next: "", currentSentinelVenueId: null })).toEqual({
      kind: "strip",
    });
  });
});

describe("selectionResolution", () => {
  // The regression: an accepted arrival (?sel=…&accept=1&src=near) resolves its
  // Venue detail while the surface trail is still initialising, so the
  // stale-sel cleanup fired on a Venue that had simply answered to its own id.
  // It stripped the acceptance markers seconds after arrival, and the reload
  // after that read a kept pub as ordinary browsing.
  it("does nothing when the Venue answered to its own id", () => {
    for (const currentVenueId of ["venue-a", null, "venue-other"]) {
      expect(selectionResolution({
        requestedVenueId: "venue-a",
        canonicalVenueId: "venue-a",
        currentVenueId,
        liveSelectedVenueId: "venue-a",
      })).toEqual({ kind: "none" });
    }
  });

  it("canonicalises the selected Venue when its id really moved", () => {
    expect(selectionResolution({
      requestedVenueId: "venue-merged",
      canonicalVenueId: "venue-canonical",
      currentVenueId: "venue-merged",
      liveSelectedVenueId: "venue-merged",
    })).toEqual({ kind: "canonicalise", venueId: "venue-canonical" });
  });

  it("preserves acceptance markers while replacing an alias with its canonical id", () => {
    const resolution = selectionResolution({
      requestedVenueId: "venue-merged",
      canonicalVenueId: "venue-canonical",
      currentVenueId: "venue-merged",
      liveSelectedVenueId: "venue-merged",
    });
    expect(resolution).toEqual({ kind: "canonicalise", venueId: "venue-canonical" });
    expect(refreshSelectionUrl(
      "/map",
      "?sel=venue-merged&accept=1&src=near",
      "venue-canonical",
    )).toBe("/map?sel=venue-canonical&accept=1&src=near");
  });

  it("canonicalises a live alias while the trail is still at root", () => {
    expect(selectionResolution({
      requestedVenueId: "venue-merged",
      canonicalVenueId: "venue-canonical",
      currentVenueId: null,
      liveSelectedVenueId: "venue-merged",
    })).toEqual({ kind: "canonicalise", venueId: "venue-canonical" });
  });

  it("cleans an alias only after the trail moved elsewhere", () => {
    expect(selectionResolution({
      requestedVenueId: "venue-merged",
      canonicalVenueId: "venue-canonical",
      currentVenueId: "venue-other",
      liveSelectedVenueId: "venue-merged",
    })).toEqual({ kind: "clean" });
  });

  it("leaves a URL that has already moved on alone", () => {
    expect(selectionResolution({
      requestedVenueId: "venue-merged",
      canonicalVenueId: "venue-canonical",
      currentVenueId: null,
      liveSelectedVenueId: "venue-somewhere-else",
    })).toEqual({ kind: "none" });
    expect(selectionResolution({
      requestedVenueId: "",
      canonicalVenueId: "venue-canonical",
      currentVenueId: null,
      liveSelectedVenueId: null,
    })).toEqual({ kind: "none" });
  });

  it("keeps the acceptance markers on a URL it decides to leave alone", () => {
    // The behavioural half: "none" means the arrival URL is untouched, so the
    // markers verifiedAcceptedArrivalSource reads are still there.
    const search = "?sel=venue-a&accept=1&src=near";
    expect(selectionResolution({
      requestedVenueId: "venue-a",
      canonicalVenueId: "venue-a",
      currentVenueId: null,
      liveSelectedVenueId: "venue-a",
    }).kind).toBe("none");
    // For contrast, the cleanup really does take them.
    expect(cleanMapUrl("/map", search)).toBe("/map");
  });
});
