import { describe, expect, it } from "vitest";

// The audit gate may waive named advisories (see WAIVED_ADVISORIES in the
// script). These tests pin the blast radius of that mechanism: a waiver
// covers exactly the advisory named, and a finding that mixes a waived
// advisory with anything else still fails. The live map is empty after the
// eslint 10 bump cleared GHSA-mh99-v99m-4gvg; classifyFindings is exercised
// with a local map so the machinery stays pinned without a live waiver.

// @ts-expect-error - plain .mjs build script, no type declarations
import { WAIVED_ADVISORIES, classifyFindings } from "../scripts/resilient-audit.mjs";

const WAIVED_URL = "https://github.com/advisories/GHSA-xxxx-waived-zzzz";
const OTHER_URL = "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz";

const EXAMPLE_WAIVERS = new Map([[WAIVED_URL, "high"]]);

function advisory(url: string, severity = "high") {
  return { source: 1, name: "pkg", dependency: "pkg", title: "t", url, severity };
}

describe("resilient-audit waivers", () => {
  it("ships with no live waivers after the eslint 10 brace-expansion clear", () => {
    expect([...WAIVED_ADVISORIES]).toEqual([]);
  });

  it("waives a finding whose only advisory is waived", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": { name: "brace-expansion", severity: "high", via: [advisory(WAIVED_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS)).toEqual({
      waived: ["brace-expansion"],
      unwaived: [],
    });
  });

  it("waives transitive findings by walking `via` package names to their root advisory", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": { name: "brace-expansion", severity: "high", via: [advisory(WAIVED_URL)] },
        minimatch: { name: "minimatch", severity: "high", via: ["brace-expansion"] },
        eslint: { name: "eslint", severity: "high", via: ["minimatch"] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual([]);
    expect(classifyFindings(report, EXAMPLE_WAIVERS).waived).toEqual([
      "brace-expansion",
      "minimatch",
      "eslint",
    ]);
  });

  it("fails an unrelated advisory", () => {
    const report = {
      vulnerabilities: {
        other: { name: "other", severity: "critical", via: [advisory(OTHER_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual(["other"]);
  });

  it("fails a waived advisory when its severity changes", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": {
          name: "brace-expansion",
          severity: "critical",
          via: [advisory(WAIVED_URL, "critical")],
        },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual(["brace-expansion"]);
  });

  it("fails a finding that mixes a waived advisory with an unwaived one", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": { name: "brace-expansion", severity: "high", via: [advisory(WAIVED_URL)] },
        mixed: { name: "mixed", severity: "high", via: ["brace-expansion", advisory(OTHER_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual(["mixed"]);
  });

  it("never waives a finding with no resolvable advisory", () => {
    const report = {
      vulnerabilities: {
        orphan: { name: "orphan", severity: "high", via: ["missing-package"] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual(["orphan"]);
  });

  it("survives a cyclic `via` graph", () => {
    const report = {
      vulnerabilities: {
        a: { name: "a", severity: "high", via: ["b"] },
        b: { name: "b", severity: "high", via: ["a", advisory(WAIVED_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual([]);
  });

  it("ignores findings below the high/critical gate level", () => {
    const report = {
      vulnerabilities: {
        moderate: { name: "moderate", severity: "moderate", via: [advisory(OTHER_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS)).toEqual({ waived: [], unwaived: [] });
  });
});
