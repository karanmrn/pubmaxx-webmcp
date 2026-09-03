import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isMapSearchField,
  TYPED_SEARCH_MIN_QUERY,
  typedSearchCameraMove,
} from "@/lib/mapSearchCamera";

// Typed map search destroyed its own input on the phone. After about two
// characters the 320ms debounce fired: one match flew to that pub through
// selectVenue, which drops the map overlay, so the search field unmounted, the
// rest of the word went nowhere and the URL stuck at "?q=Qu". Several matches
// refitted the camera instead and threw the viewport out past the M25 while the
// reader was still typing.

const move = (over: Partial<Parameters<typeof typedSearchCameraMove>[0]> = {}) =>
  typedSearchCameraMove({
    query: "Ice Wharf",
    matchCount: 1,
    searchFieldFocused: false,
    cameraOwnedByPick: false,
    ...over,
  });

describe("typed search camera", () => {
  it("holds the camera still while the field has the caret", () => {
    // The exact defect: a whole pub name typed, one match waiting, caret still
    // in the field. Nothing may move, because moving unmounts the field.
    expect(move({ searchFieldFocused: true })).toBe("none");
    expect(move({ searchFieldFocused: true, matchCount: 12 })).toBe("none");
    expect(move({ searchFieldFocused: true, matchCount: 0 })).toBe("none");
  });

  it("holds it still for every length past the two-character mark", () => {
    for (const query of ["Qu", "Que", "Queen", "Queens Head"]) {
      expect(move({ query, searchFieldFocused: true, matchCount: 3 })).toBe("none");
    }
  });

  it("defers the move rather than dropping it", () => {
    expect(move({ matchCount: 1 })).toBe("select-one");
    expect(move({ matchCount: 12 })).toBe("fit-many");
  });

  it("never moves on a stray key or a miss", () => {
    expect(move({ query: "Q", matchCount: 1 })).toBe("none");
    expect(TYPED_SEARCH_MIN_QUERY).toBe(2);
    expect(move({ matchCount: 0 })).toBe("none");
  });

  it("stands down once the reader has picked an answer", () => {
    expect(move({ cameraOwnedByPick: true, matchCount: 12 })).toBe("none");
    expect(move({ cameraOwnedByPick: true, matchCount: 1 })).toBe("none");
  });

  it("recognises the map search fields and nothing else", () => {
    const field = { matches: (selector: string) => selector === ".mapSearchSuggest input" };
    const other = { matches: () => false };
    expect(isMapSearchField(field as unknown as Element)).toBe(true);
    expect(isMapSearchField(other as unknown as Element)).toBe(false);
    expect(isMapSearchField(null)).toBe(false);
  });

  it("is the seam PubMap actually types through", () => {
    const source = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
    expect(source).toContain("typedSearchCameraMove({");
    expect(source).toContain("searchFieldFocused: isMapSearchField(document.activeElement)");
    // The effect re-runs when focus leaves, which is what makes the move
    // deferred rather than dropped.
    expect(source).toContain("if (mapSearchFieldFocused) return;");
    // Membership, not the whole bracketed list: the effect carries a second
    // guard (the phone search overlay), and a closed list would read that
    // legitimate addition as the focus dependency having gone.
    const deps = /\}, \[([^\]]*)\]\);/.exec(
      source.slice(source.indexOf("const searchOverlayOpen")),
    )?.[1] ?? "";
    expect(deps.split(",").map((dep) => dep.trim())).toContain("mapSearchFieldFocused");
  });
});
