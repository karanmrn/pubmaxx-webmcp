// THE DYNAMIC FEED MUST SHIP WITH THE FILES IT OPENS.
//
// /feed is force-dynamic, so app/feed/feedSightings.server.ts reads the
// drink-price overlay and lib/venueIndex.ts reads every enabled city's slim
// venue pack at REQUEST time, each by a path joined to process.cwd() from
// config. Next traces only paths it can see statically, so it traces none of
// these; whether they are in the function is an accident of how Vercel grouped
// the routes into lambdas, exactly as it was for the freshness cron
// (__tests__/freshnessTracing.test.ts).
//
// The failure here hides itself: getVenueIndex swallows a missing pack per city,
// every grouping key then resolves to null, and the ambient surface renders
// empty — identical to the honest "nobody has logged tonight" state. So this
// fence pins the declaration, and pins it against the SAME sources the app
// reads: the freshness registry for the overlay, lib/cities.ts for the packs.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listEnabledCities } from "@/lib/cities";
import { CITY_VENUE_PACKS } from "@/lib/cityVenuePacks.mjs";
import { VENUE_ALIASES_TRACING_INCLUDE } from "@/lib/venueAliasesFile.mjs";
import registry from "@/data/freshness_registry.json";

const FEED_ROUTE = "/feed";

const overlayArtifact = registry.datasets.find((d) => d.id === "drink_price_updates")?.artifact;

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

describe("feed data-file tracing", () => {
  const includes = tracingIncludes();

  it("declares tracing includes for the dynamic feed route", () => {
    expect(includes?.[FEED_ROUTE], "/feed must declare the files it opens").toBeDefined();
  });

  it("traces the sourced-price overlay the feed reads at request time", () => {
    expect(typeof overlayArtifact).toBe("string");
    expect(includes[FEED_ROUTE]).toContain(`./${overlayArtifact}`);
  });

  it("traces every enabled city's venue pack, so name resolution cannot fail soft", () => {
    const cities = listEnabledCities();
    expect(cities.length).toBeGreaterThan(0);
    for (const city of cities) {
      expect(
        includes[FEED_ROUTE],
        `/feed is missing ${city.id}'s venue pack`,
      ).toContain(`./public${city.slimVenuesPath}`);
    }
  });

  it("keeps the app's city config and the deployment's pack list one list", () => {
    const fromCityConfig = listEnabledCities().map((city) => `./public${city.slimVenuesPath}`);
    const fromPackTable = Object.values(CITY_VENUE_PACKS)
      .filter((pack) => pack.enabled)
      .map((pack) => `./public${pack.slimVenuesPath}`);

    expect(new Set(fromPackTable)).toEqual(new Set(fromCityConfig));
  });

  it("traces nothing the feed never opens, so the function stays small", () => {
    // The alias map joins this set because every venue-index lookup resolves a
    // possibly-merged id through lib/venueAliases.ts before it reads a pack.
    const expected = new Set([
      `./${overlayArtifact}`,
      VENUE_ALIASES_TRACING_INCLUDE,
      ...listEnabledCities().map((city) => `./public${city.slimVenuesPath}`),
    ]);
    expect(new Set(includes[FEED_ROUTE])).toEqual(expected);
  });
});
