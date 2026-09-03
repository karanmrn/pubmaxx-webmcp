// THE FRESHNESS SPINE MUST SHIP WITH ITS ARTIFACTS.
//
// Both freshness readers resolve each dataset's artifact by a path taken from
// data/freshness_registry.json and joined to process.cwd() at request time. Next
// only traces paths it can see statically, so it traces none of these, and which
// files land in a given serverless function is then an accident of how Vercel
// grouped the routes into lambdas. /api/freshness was grouped with routes that do
// statically read those files and worked; /api/cron/freshness-audit, isolated into
// its own function by `maxDuration`, shipped with no artifacts at all and reported
// every field-stamped feed as "unknown" every morning for weeks.
//
// So next.config.mjs declares them, derived from the registry rather than
// hand-copied. This fence pins that: add a FIELD-stamped dataset, or a declared
// row PACK, and it is traced into both functions, or this test fails.
//
// Those two are the whole list, because they are exactly the list a reader opens
// (lib/freshness.ts datasetOpensArtifact): a bare literal stamp is answered from
// the registry and an unstamped dataset is never dated, so tracing either would
// ship megabytes (pint_prices alone is ~7 MB) into both functions to be parsed by
// nobody — the bloat that ruled out a glob. A pack is the exception on purpose:
// its rows ARE the finding, so leaving it untraced makes an empty-pack alert
// unreachable in production and the feed reads fresh forever.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import registry from "@/data/freshness_registry.json";
import { freshnessArtifactIncludes } from "@/lib/freshnessTracing.mjs";

const FRESHNESS_ROUTES = ["/api/freshness", "/api/cron/freshness-audit"] as const;

type RegistryDataset = (typeof registry.datasets)[number] & { pack?: boolean };

const opensArtifact = (d: RegistryDataset) => d.stamp?.kind === "field" || d.pack === true;

const readArtifacts = (registry.datasets as RegistryDataset[])
  .filter(opensArtifact)
  .map((d) => d.artifact)
  .filter((a): a is string => typeof a === "string");

const unreadArtifacts = (registry.datasets as RegistryDataset[])
  .filter((d) => !opensArtifact(d))
  .map((d) => d.artifact)
  .filter((a): a is string => typeof a === "string");

// next.config.mjs is plain JS the app never type-checks, so it is loaded the way
// Next itself loads it (evaluated in Node) rather than imported. That also proves
// the config still evaluates, which a static read of the file would not.
function tracingIncludes(): Record<string, string[]> {
  const root = join(__dirname, "..");
  const out = execFileSync(
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
  return JSON.parse(out) as Record<string, string[]>;
}

describe("freshness artifact tracing", () => {
  const includes = tracingIncludes();

  it("declares tracing includes for both freshness readers", () => {
    expect(includes).toBeDefined();
    for (const route of FRESHNESS_ROUTES) {
      expect(includes?.[route], `${route} must declare its artifacts`).toBeDefined();
    }
  });

  it("traces every artifact a reader opens into every freshness function", () => {
    expect(readArtifacts.length).toBeGreaterThan(0);
    for (const route of FRESHNESS_ROUTES) {
      const declared = new Set(includes?.[route] ?? []);
      for (const artifact of readArtifacts) {
        expect(declared.has(`./${artifact}`), `${route} is missing ${artifact}`).toBe(true);
      }
    }
  });

  it("traces nothing a reader never opens, so the function stays small", () => {
    const needed = new Set(readArtifacts.map((a) => `./${a}`));
    expect(unreadArtifacts.length).toBeGreaterThan(0);
    for (const route of FRESHNESS_ROUTES) {
      const declared = includes?.[route] ?? [];
      for (const path of declared) {
        expect(needed.has(path), `${route} traces unread ${path}`).toBe(true);
      }
      for (const artifact of unreadArtifacts) {
        expect(declared.includes(`./${artifact}`), `${route} traces unread ${artifact}`).toBe(false);
      }
    }
  });

  it("derives the list, so a newly field-stamped dataset is traced with no edit here", () => {
    const synthetic = {
      datasets: [
        { id: "brand-new", artifact: "public/data/brand_new/latest.json", stamp: { kind: "field", pointer: "generatedAt" } },
        { id: "literal", artifact: "public/data/huge.json", stamp: { kind: "literal", value: "2026-07-01" } },
        { id: "unstamped", artifact: "public/data/reference.json", stamp: null },
        { id: "no-artifact", artifact: null, stamp: { kind: "field", pointer: "generatedAt" } },
      ],
    };
    expect(freshnessArtifactIncludes(synthetic)).toEqual(["./public/data/brand_new/latest.json"]);
  });

  it("traces a declared row pack, so its empty-pack finding can fire in production", () => {
    const synthetic = {
      datasets: [
        { id: "pack", artifact: "public/data/rows.json", pack: true, stamp: { kind: "literal", value: "2026-07-01" } },
        { id: "literal", artifact: "public/data/huge.json", stamp: { kind: "literal", value: "2026-07-01" } },
        { id: "pack-no-artifact", artifact: null, pack: true, stamp: null },
      ],
    };
    expect(freshnessArtifactIncludes(synthetic)).toEqual(["./public/data/rows.json"]);
  });

  it("ships the historic pubs pack to both readers, so an empty index is a finding", () => {
    const historic = (registry.datasets as RegistryDataset[]).find(
      (d) => d.id === "historic_pubs",
    );
    expect(historic?.pack).toBe(true);
    expect(historic?.artifact).toBe("public/data/historic_pubs.json");
    for (const route of FRESHNESS_ROUTES) {
      expect(includes?.[route]).toContain("./public/data/historic_pubs.json");
    }
  });

  it("declares exactly what the shared derivation returns for the real registry", () => {
    const derived = freshnessArtifactIncludes(registry);
    expect(derived).toEqual(readArtifacts.map((a) => `./${a}`));
    for (const route of FRESHNESS_ROUTES) {
      expect(includes?.[route]).toEqual(derived);
    }
  });
});
