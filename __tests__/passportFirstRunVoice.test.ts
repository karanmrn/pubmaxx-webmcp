import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pint Passport first-run voice fence. The own-profile line is behind sign-in,
// so a keyless run can never paint it — this reads its SOURCE, the way the
// messages fence does (__tests__/messagesFrictionVoice.test.ts).
//
// What is pinned here:
//   1. The blank passport is an empty state, so docs/VOICE.md lets its aside be
//      an actual joke — but only on the OWN profile. A visitor reading someone
//      else's blank page is not the person being ribbed, so that branch stays
//      plain.
//   2. An empty state has to hand the reader somewhere to go, not just a line.
//   3. The voice rules that apply to every surface: no em dash, no exclamation
//      mark, British spelling, no banned or plumbing words.

const PASSPORT = "components/profile/PintPassport.tsx";
// A short distinctive phrase, not the whole sentence: the fence guards the
// joke, not its exact wording.
const OWN_ASIDE = "a blank one takes discipline";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

// The first-run block's source, from its wrapper to the stat grid below it.
const firstRunBlock = (): string => {
  const source = read(PASSPORT);
  const start = source.indexOf('className="passportFirstRun"');
  const end = source.indexOf("The stat grid renders");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

// What a reader actually reads: the copy literals and the link labels, with
// class names and hrefs left out of it.
const firstRunCopy = (): string => {
  const block = firstRunBlock();
  const literals = (block.match(/"[^"\n]+"/g) ?? [])
    .map((literal) => literal.slice(1, -1))
    .filter((literal) => literal.includes(" "));
  const textNodes = (block.match(/>[^<>{}]+</g) ?? [])
    .map((node) => node.slice(1, -1).trim())
    .filter(Boolean);
  return [...literals, ...textNodes].join("\n");
};

describe("pint passport first-run voice", () => {
  it("the blank own passport carries its aside", () => {
    expect(firstRunBlock()).toContain(OWN_ASIDE);
  });

  it("the aside is for the holder only, and a visitor gets the plain line", () => {
    const block = firstRunBlock();
    // The joke sits inside the isOwn branch; the visitor branch is the one
    // after it and states the fact.
    const ownBranchAt = block.indexOf("isOwn");
    const asideAt = block.indexOf(OWN_ASIDE);
    expect(ownBranchAt).toBeGreaterThan(-1);
    expect(asideAt).toBeGreaterThan(ownBranchAt);
    expect(block).toContain("No pints logged here yet.");
    const visitorAt = block.indexOf("No pints logged here yet.");
    expect(visitorAt).toBeGreaterThan(asideAt);
  });

  it("the blank passport hands the holder somewhere to go", () => {
    const block = firstRunBlock();
    expect(block).toContain('href="/map"');
    expect(block).toContain('href="/map?log=1"');
    expect(block).toContain("Log a pint");
  });

  it("the first-run copy keeps the punctuation rules", () => {
    const copy = firstRunCopy();
    for (const mark of ["—", "&mdash;", " – ", "!"]) {
      expect(copy.includes(mark), `"${mark}" found in the first-run copy`).toBe(false);
    }
  });

  it("the first-run copy leaks no banned or plumbing word", () => {
    const copy = firstRunCopy().toLowerCase();
    const banned = [
      "experience",
      "discover",
      "elevate",
      "seamless",
      "curated",
      "unleash",
      "empower",
      "vibrant",
      "delve",
      "dive into",
      "journey",
      "effortless",
      "immerse",
      "robust",
      "leverage",
      "unlock",
      "at your fingertips",
      // Rule 2 plumbing.
      "capture",
      "evidence gate",
      "snapshot",
      "provenance",
      "night area",
      // Rule "no begging".
      "check back later",
      "don't miss out",
    ];
    for (const word of banned) {
      expect(copy.includes(word), `"${word}" found in the first-run copy`).toBe(false);
    }
  });

  it("the first-run copy stays British", () => {
    const copy = firstRunCopy().toLowerCase();
    for (const american of ["color", "favorite", "realize", "traveled", "license plate"]) {
      expect(copy.includes(american), `"${american}" found in the first-run copy`).toBe(false);
    }
  });
});
