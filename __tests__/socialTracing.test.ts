import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listEnabledCities } from "@/lib/cities";
import registry from "@/data/freshness_registry.json";

const root = join(__dirname, "..");

function tracingIncludes(): Record<string, string[]> {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.argv[1]);" +
        "console.log(JSON.stringify(m.default.outputFileTracingIncludes ?? null));",
      join(root, "next.config.mjs"),
    ],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(output) as Record<string, string[]>;
}

describe("Social data-file tracing", () => {
  it("ships only the city packs that public Social discovery opens on the server", () => {
    const files = tracingIncludes()["/social"];
    const expected = listEnabledCities().map(
      (city) => `./public${city.slimVenuesPath}`,
    );
    const priceOverlay = registry.datasets.find(
      (dataset) => dataset.id === "drink_price_updates",
    )?.artifact;

    expect(files).toEqual(expected);
    expect(files).not.toContain(`./${priceOverlay}`);
  });
});
