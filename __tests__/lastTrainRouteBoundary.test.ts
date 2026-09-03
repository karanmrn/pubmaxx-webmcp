import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("last-train route boundary", () => {
  it("keeps TfL business logic in the server module", () => {
    const route = readFileSync(
      path.join(__dirname, "..", "app", "api", "last-train", "route.ts"),
      "utf8",
    );

    expect(route).toContain('from "@/lib/lastTrain.server"');
    expect(route).not.toMatch(/function\s+(nearestStation|collectSchedules|journeyRank)\b/);
    expect(route.split("\n").length).toBeLessThanOrEqual(30);
  });
});
