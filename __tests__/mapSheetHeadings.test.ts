import { describe, expect, it } from "vitest";

import { nearMeAnswerHeadline } from "@/lib/nearMeAnswer";
import { MAP_SHEET_TITLES, type MapSheetKind } from "@/lib/mobileShell";

// One heading per sheet.
//
// The mobile sheet chrome prints the sheet's only heading, and that heading is
// the dialog's accessible name. The near-me sheet used to be titled "Cheapest
// listed near you" while its body printed the same sentence as a second <h2>
// directly below it. Deleting one of the two is not enough: the chrome title is
// FIXED and the body's line MOVES, so a chrome title copied from one of the
// body's states is either a repeat or a contradiction.
//
// These hold the two apart. The chrome may not say what the body says, in any
// state the body can reach.

/** Every headline the near-me body can print. */
const REACHABLE_HEADLINES = [
  nearMeAnswerHeadline({ scope: "walkable" }),
  nearMeAnswerHeadline({ scope: "widened" }),
  nearMeAnswerHeadline({ scope: "none" }),
  nearMeAnswerHeadline({ scope: "walkable", borough: "Camden" }),
  nearMeAnswerHeadline({ scope: "widened", patchLabel: "Soho" }),
];

describe("map sheet chrome titles", () => {
  it("gives the near-me sheet a title none of its answers restates", () => {
    const title = MAP_SHEET_TITLES["near-me"];
    expect(title).toBeTruthy();
    for (const headline of REACHABLE_HEADLINES) {
      expect(headline).not.toBe(title);
    }
  });

  it("keeps the near-me answer honest about which answer it gave", () => {
    // A widened ring is not "near you", and a picked area is not near the
    // reader at all. Each state names itself, so the chrome cannot.
    expect(nearMeAnswerHeadline({ scope: "walkable" })).toContain("near you");
    expect(nearMeAnswerHeadline({ scope: "widened" })).not.toContain("near you");
    expect(nearMeAnswerHeadline({ scope: "walkable", borough: "Camden" })).toBe(
      "Cheapest listed in Camden",
    );
    expect(nearMeAnswerHeadline({ scope: "widened", patchLabel: "Soho" })).toBe(
      "Cheapest listed around Soho",
    );
  });

  it("names a picked area over the ring it was reached from", () => {
    // Borough wins over patch, and both win over scope: the reader chose it.
    expect(
      nearMeAnswerHeadline({
        scope: "widened",
        borough: "Camden",
        patchLabel: "Soho",
      }),
    ).toBe("Cheapest listed in Camden");
  });

  it("titles every sheet the map can open", () => {
    const opened: MapSheetKind[] = [
      "filters",
      "tfl",
      "tonight",
      "layers",
      "pub-pal",
      "moment",
      "near-me",
      "area",
      "choose-area",
    ];
    for (const kind of opened) {
      expect(MAP_SHEET_TITLES[kind], kind).toBeTruthy();
    }
  });
});
