// What the people directory says when it has nobody left to offer.
//
// A discovery list that filters is a list that can empty out, and the sentence
// it prints then is the whole difference between "you have met everyone here"
// and "this place is deserted". Those are opposite facts about the same screen,
// so the line has ONE owner (`directoryEmptyLine`) and this file pins the rule
// where it lives, then proves the component asks it rather than keeping a copy.
// A second copy of the sentence is exactly how a drinker with a full lot comes
// to be told nobody has claimed a handle yet.
//
// The starter packs are the other half of the fence. A pack is a named bundle
// and its members carry their own follow state on purpose, so the discovery
// filter must stay out of that lane.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  directoryEmptyLine,
  discoverableRows,
  followSet,
} from "@/lib/peopleDirectory";

const read = (file: string): string =>
  readFileSync(join(process.cwd(), file), "utf8");

const DIRECTORY = read("components/social/PeopleDirectory.tsx");
const PACKS = read("components/social/StarterPacks.tsx");
const PACKS_POLICY = read("lib/starterPacks.ts");

/**
 * Code only. A comment may name the rule to explain it; the same split the
 * starter-packs and crews-and-people fences use.
 */
const code = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");

describe("the empty line says which empty this is", () => {
  it("tells a viewer who follows everybody that they follow everybody", () => {
    const line = directoryEmptyLine({ alreadyFollowing: 4, moreToLoad: false });
    expect(line).toBe(
      "You already follow everyone here. Search a handle to find somebody new.",
    );
    expect(line).not.toContain("Nobody has claimed a handle");
  });

  it("does not claim to have shown everyone while a page is still unread", () => {
    // The reader can see the "Show more people" button, so a line saying the
    // list is finished would be contradicted on the same screen.
    const line = directoryEmptyLine({ alreadyFollowing: 4, moreToLoad: true });
    expect(line).toContain("Show more people");
    expect(line).not.toContain("everyone here.");
  });

  it("keeps the empty-city line for an empty city", () => {
    expect(directoryEmptyLine({ alreadyFollowing: 0, moreToLoad: false })).toBe(
      "Nobody has claimed a handle yet. You could be first.",
    );
  });

  it("obeys house law: no em dash, no exclamation, no begging", () => {
    for (const alreadyFollowing of [0, 1, 9]) {
      for (const moreToLoad of [false, true]) {
        const line = directoryEmptyLine({ alreadyFollowing, moreToLoad });
        expect(line).not.toMatch(/[—–]/u);
        expect(line).not.toContain("!");
        expect(line.toLowerCase()).not.toContain("check back");
        expect(line.toLowerCase()).not.toContain("please try");
      }
    }
  });
});

describe("the filter itself", () => {
  it("keeps the row set whole when the follow read could not answer", () => {
    const rows = [{ handle: "alice" }, { handle: "bob" }];
    expect(discoverableRows(rows, null)).toEqual(rows);
  });

  it("matches on the canonical handle, not on what was typed", () => {
    const rows = [{ handle: "alice" }, { handle: "bob" }];
    expect(discoverableRows(rows, followSet(["@Alice"]))).toEqual([
      { handle: "bob" },
    ]);
  });

  it("drops an empty handle from the follow set rather than matching one", () => {
    const rows = [{ handle: "alice" }];
    expect(discoverableRows(rows, followSet(["", "  ", "@"]))).toEqual(rows);
  });
});

describe("the surface asks the owner", () => {
  it("prints the empty line through directoryEmptyLine and keeps no copy", () => {
    const body = code(DIRECTORY);
    expect(body).toContain("directoryEmptyLine({");
    expect(body).not.toContain("Nobody has claimed a handle yet");
    expect(body).not.toContain("You already follow everyone");
  });

  it("asks the read for its own viewer, so the page arrives filtered", () => {
    expect(code(DIRECTORY)).toContain("&viewer=${encodeURIComponent(viewer)}");
  });

  it("takes a landed follow off the list instead of leaving its receipt", () => {
    const body = code(DIRECTORY);
    expect(body).toMatch(
      /setPeople\(\(current\) =>\s*current\.filter\(\(person\) => normalizeHandle\(person\.handle\) !== clean\)/,
    );
  });
});

describe("a card gives way rather than crushing itself", () => {
  const CSS = read("components/social/peopleDirectory.css");
  const cardRule = CSS.match(/\.peopleDir__card \{[^}]*\}/)?.[0] ?? "";

  it("wraps the control onto its own line instead of squeezing the identity", () => {
    // The two-up breakpoint is the WINDOW's, and this section can sit in a rail
    // about 275px wide on a 1440 screen. As a two-column grid that left the
    // nowrap control taking what it needed and "@cara" breaking across two
    // lines under an avatar the button was sitting on.
    expect(cardRule).toContain("flex-wrap: wrap");
    expect(cardRule).not.toContain("grid-template-columns");
  });

  it("keeps the 44px tap floor on the control", () => {
    expect(CSS).toMatch(/\.peopleDir__button \{[^}]*min-height: 44px/);
  });
});

describe("the starter packs keep their own rules", () => {
  it("never reaches for the discovery filter", () => {
    // A pack legitimately shows a member the viewer already follows, with that
    // member's own follow state on the row. Membership is the pack's question
    // (lib/starterPacks.ts), and it is a different one.
    for (const source of [PACKS, PACKS_POLICY]) {
      expect(source).not.toContain("discoverableRows");
      expect(source).not.toContain("peopleDirectory");
    }
  });
});
