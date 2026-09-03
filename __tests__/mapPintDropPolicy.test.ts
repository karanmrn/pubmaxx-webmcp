import { describe, expect, it } from "vitest";

import { filterMapPintDropEntries } from "@/lib/mapPintDropPolicy";

describe("filterMapPintDropEntries", () => {
  it("keeps pub history while excluding canonical bars and food from map surfaces", () => {
    const venues = [
      { id: "venue-pub", kind: "pub" as const },
      { id: "venue-legacy-pub", kind: undefined },
      { id: "venue-1kpe609", kind: "bar" as const },
      { id: "food-kebab", kind: "food" as const },
    ];
    const entries = new Map([
      ["venue-pub", ["pub drop"]],
      ["venue-legacy-pub", ["legacy pub drop"]],
      ["venue-1kpe609", ["historical French House drop"]],
      ["food-kebab", ["food drop"]],
      ["venue-missing", ["orphan drop"]],
    ]);

    expect([...filterMapPintDropEntries(venues, entries)]).toEqual([
      ["venue-pub", ["pub drop"]],
      ["venue-legacy-pub", ["legacy pub drop"]],
    ]);
  });
});
