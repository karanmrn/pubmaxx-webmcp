import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildMapSearchSuggestions } from "@/lib/mapSearchSuggest";

/**
 * Taste gate 2026-08-02, finding M6 - the suggestion row cut the name.
 *
 * Rows read "King's ..." and "Shore..." at 390px, because the name truncated to
 * protect a repeated "Plan with warnings" chip beside it. The name is the row:
 * a reader picks a place by its name, and planning words belong on the surface
 * that plans. The chip left the row; the name wraps instead of truncating.
 *
 * This reads the shipped CSS and markup, because a headless run lays out
 * nothing and the defect only shows at a phone width.
 */

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const suggestCss = read("components/map/mapSearchSuggest.css");
const suggest = read("components/map/MapSearchSuggest.tsx");

// Anchored to a line start on purpose. Unanchored, the FIRST match for
// `.mapSearchSuggestMeta` is the tail of `.mapSearchSuggest--overlay
// .mapSearchSuggestMeta`, so the overlay variant shadows the plain rule and the
// assertions below read a block they were never written about.
function rule(selector: string): string {
  const match = suggestCss.match(
    new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`, "m"),
  );
  expect(match, `the ${selector} rule`).not.toBeNull();
  return match![1];
}

describe("finding M6 - the name owns the suggestion row", () => {
  it("never truncates the name", () => {
    const name = rule(".mapSearchSuggestRowName");
    expect(name, "no ellipsis").not.toMatch(/text-overflow/);
    expect(name, "the name wraps").not.toMatch(/white-space:\s*nowrap/);
    expect(name, "and it is never clipped").not.toMatch(/overflow:\s*hidden/);
    // It can shrink inside its flex row, so a long name wraps rather than
    // pushing the distance label off the end.
    expect(name).toMatch(/min-width:\s*0/);
  });

  it("keeps the price whole beside a wrapped name", () => {
    // A wrapping name asks for more room than a truncated one. The meta cell
    // holds the price and the distance, so it may not shrink: it did, and the
    // price painted over the borough beside it.
    expect(rule(".mapSearchSuggestMeta")).toMatch(/flex:\s*none/);
    // The quiet labels wrap under the name instead of taking its line.
    expect(rule(".mapSearchSuggestRowMain")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("drops the planning chip from a row that only flies the camera", () => {
    expect(suggest, "no chip markup").not.toContain("mapSearchSuggestCoverage");
    expect(suggestCss, "and no chip styling survives").not.toContain(
      ".mapSearchSuggestCoverage",
    );
    // The coverage still travels with the pick, so the area sheet can say it.
    expect(suggest).toMatch(/coverage: item\.coverage/);
  });

  it("still hands the row a full name to print", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "king",
      venues: [],
      userLocation: null,
      mapCenter: [-0.1276, 51.5072],
    });
    const kings = result.areas.find((area) => area.name.startsWith("King"));
    expect(kings?.name).toBe("King's Cross");
  });
});
