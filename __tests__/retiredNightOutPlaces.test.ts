import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RETIRED_RUNTIME_SYMBOLS = [
  "placesForNightOutJob",
  "loadNightOutPlaceSnapshot",
  "createNightOutPlacesHandler",
  "ingest_night_out_places",
] as const;

function sourceFilesBelow(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFilesBelow(child);
    return /\.(?:[cm]?[jt]sx?|json|ya?ml)$/u.test(entry.name) ? [child] : [];
  });
}

describe("retired night-out places experiment", () => {
  it("has no runtime route, ingest command, freshness feed, or tracing pack", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "app/api/night-out-places"))).toBe(false);
    expect(existsSync(join(root, "app/api/night-out-places/route.ts"))).toBe(false);
    expect(existsSync(join(root, "scripts/ingest_night_out_places.mjs"))).toBe(false);
    expect(existsSync(join(root, "scripts/ingest_night_out_places.d.mts"))).toBe(false);
    expect(existsSync(join(root, "public/data/night_out_places/latest.json"))).toBe(false);
    expect(existsSync(join(root, "data/night_out_place_provenance_registry.json"))).toBe(false);
    expect(existsSync(join(root, "docs/NIGHT_OUT_PLACE_INGEST.md"))).toBe(false);

    for (const path of [
      "README.md",
      "package.json",
      "data/freshness_registry.json",
      "docs/API_CONTRACTS_THE_LOCAL.md",
      "lib/venueIndexTracing.mjs",
      "scripts/validate-data.mjs",
      "docs/FRESHNESS_BURNDOWN.md",
      "docs/GATE_0_RECONCILIATION.md",
      "docs/WAYFINDER_LIVE_DATA.md",
    ]) {
      const content = readFileSync(join(root, path), "utf8");
      expect(content).not.toContain("night_out_places");
      expect(content).not.toContain("night-out-places");
      expect(content).not.toContain("NIGHT_OUT_PLACE_INGEST");
    }

    const activeRuntimeFiles = [
      ...sourceFilesBelow(join(root, "app")),
      ...sourceFilesBelow(join(root, "components")),
      ...sourceFilesBelow(join(root, "lib")),
      ...sourceFilesBelow(join(root, "scripts")),
      ...sourceFilesBelow(join(root, ".github/workflows")),
      join(root, "instrumentation-client.ts"),
      join(root, "proxy.ts"),
      join(root, "eslint.config.mjs"),
      join(root, "next.config.mjs"),
      join(root, "package.json"),
      join(root, "vercel.json"),
    ].filter(existsSync);

    for (const path of activeRuntimeFiles) {
      const content = readFileSync(path, "utf8");
      for (const symbol of RETIRED_RUNTIME_SYMBOLS) {
        expect(content, `${symbol} remains in ${path}`).not.toContain(symbol);
      }
    }
  });
});
