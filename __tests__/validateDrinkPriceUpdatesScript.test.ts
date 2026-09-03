// Integration test for the drink-price-update validation wired into
// scripts/validate-data.mjs (E2 of docs/PRD_ALL_DRINKS.md). Runs the actual
// script as a subprocess against a temp copy of public/data/ so we exercise
// real file I/O + real exit-code behaviour, not just a re-implementation of
// its logic.
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCRIPT = resolve(
  process.env.POSTCODE_VALIDATE_DATA_SCRIPT ??
    join(ROOT, "scripts", "validate-data.mjs"),
);
const POSTCODE_CONSISTENCY_MODULE = resolve(
  process.env.POSTCODE_CONSISTENCY_MODULE ??
    join(ROOT, "scripts", "lib", "postcodeCoordinateConsistency.mjs"),
);
const BUILD_SLIM_SCRIPT = join(ROOT, "scripts", "build_slim_index.mjs");
const DETAIL_INDEX = join(ROOT, "data", "generated", "venue_detail_index.json");

const tempDirs: string[] = [];

// Build a scratch copy of the repo's public/data/ (the real bundled datasets
// are needed too, since the script validates all of them in one run) plus a
// drink_price_updates/ directory containing exactly the given file bodies.
function setupScratch(files: Record<string, unknown>): string {
  if (!existsSync(DETAIL_INDEX)) {
    execFileSync("node", [BUILD_SLIM_SCRIPT], { cwd: ROOT });
  }
  const scratchRoot = mkdtempSync(join(tmpdir(), "validate-data-test-"));
  tempDirs.push(scratchRoot);
  const scratchScripts = join(scratchRoot, "scripts");
  const scratchData = join(scratchRoot, "public", "data");
  const scratchGeneratedData = join(scratchRoot, "data", "generated");
  const scratchFamousVenues = join(scratchRoot, "data", "famous_venues");
  const scratchLib = join(scratchRoot, "lib");
  mkdirSync(scratchScripts, { recursive: true });
  mkdirSync(join(scratchScripts, "lib"), { recursive: true });
  mkdirSync(scratchLib, { recursive: true });
  mkdirSync(scratchData, { recursive: true });
  mkdirSync(scratchGeneratedData, { recursive: true });
  mkdirSync(scratchFamousVenues, { recursive: true });
  // Copy the real script (unmodified) and the real bundled datasets it also
  // validates, so the run reflects production data validation end-to-end.
  cpSync(SCRIPT, join(scratchScripts, "validate-data.mjs"));
  cpSync(
    join(ROOT, "scripts", "lib", "validateLateFoodEvidence.mjs"),
    join(scratchScripts, "lib", "validateLateFoodEvidence.mjs"),
  );
  cpSync(
    join(ROOT, "scripts", "lib", "slimShards.mjs"),
    join(scratchScripts, "lib", "slimShards.mjs"),
  );
  if (existsSync(POSTCODE_CONSISTENCY_MODULE)) {
    cpSync(
      POSTCODE_CONSISTENCY_MODULE,
      join(scratchScripts, "lib", "postcodeCoordinateConsistency.mjs"),
    );
    // postcodeCoordinateConsistency imports the shared geo primitives. Keep
    // the scratch copy executable when that dependency is present in the real
    // validator tree.
    cpSync(
      join(ROOT, "scripts", "lib", "geo.mjs"),
      join(scratchScripts, "lib", "geo.mjs"),
    );
  }
  cpSync(
    join(ROOT, "lib", "nightOutPlaceSourceUrl.mjs"),
    join(scratchLib, "nightOutPlaceSourceUrl.mjs"),
  );
  cpSync(
    join(ROOT, "lib", "nightOutPlaceContract.mjs"),
    join(scratchLib, "nightOutPlaceContract.mjs"),
  );
  // The dated Pint Index editions are hashed over one shared canonical form,
  // which the script imports rather than restates; without it the scratch run
  // dies at module resolution before it validates anything.
  cpSync(
    join(ROOT, "lib", "pintIndexCanonical.mjs"),
    join(scratchLib, "pintIndexCanonical.mjs"),
  );
  cpSync(
    join(ROOT, "lib", "editorialRss.mjs"),
    join(scratchLib, "editorialRss.mjs"),
  );
  // What's-On files share one row-shape predicate with the app. The validator
  // imports it, so scratch runs must carry the same module.
  cpSync(
    join(ROOT, "lib", "whatsOnRowShape.mjs"),
    join(scratchLib, "whatsOnRowShape.mjs"),
  );
  // The UK place index is checked against the same name rule the chooser and
  // the builder share, which the script imports rather than restates.
  cpSync(
    join(ROOT, "lib", "ukPlaceName.mjs"),
    join(scratchLib, "ukPlaceName.mjs"),
  );
  // Which city packs ship, and the one box each is cut to and rendered inside.
  // Both are read rather than restated, so the scratch run needs them.
  cpSync(
    join(ROOT, "lib", "cityVenuePacks.mjs"),
    join(scratchLib, "cityVenuePacks.mjs"),
  );
  cpSync(join(ROOT, "lib", "cityBounds.mjs"), join(scratchLib, "cityBounds.mjs"));
  cpSync(join(ROOT, "lib", "editorialRss.mjs"), join(scratchLib, "editorialRss.mjs"));
  for (const f of [
    "london_pois.json",
    "london_localities.json",
    "tfl_lines.json",
    "pint_prices_app_dataset.json",
    "pubmaxxing_seed_snapshot.json",
    "pint_index_snapshot.json",
    "late_food_evidence.json",
  ]) {
    cpSync(join(ROOT, "public", "data", f), join(scratchData, f));
  }
  // The slim monolith + every shard the build emits (manifest, core, and one
  // per hollow outer borough) — validateSlimShards recomputes and checks them.
  for (const f of readdirSync(join(ROOT, "public", "data"))) {
    if (f.startsWith("venues_slim") && f.endsWith(".json")) {
      cpSync(join(ROOT, "public", "data", f), join(scratchData, f));
    }
  }
  // UK base rows can name curated owners from any supported city. Mirror the
  // city slim indexes so owner validation sees the same inputs as production.
  cpSync(join(ROOT, "public", "data", "cities"), join(scratchData, "cities"), {
    recursive: true,
  });
  // The UK base layer ships as a directory of per-cell shards + a manifest;
  // validateUkBaseShards reads every one of them, so the scratch needs the
  // whole directory rather than a named file list.
  cpSync(join(ROOT, "public", "data", "uk_base"), join(scratchData, "uk_base"), {
    recursive: true,
  });
  mkdirSync(join(scratchData, "night_signals"), { recursive: true });
  cpSync(
    join(ROOT, "public", "data", "night_signals", "latest.json"),
    join(scratchData, "night_signals", "latest.json"),
  );
  const scratchOsmDir = join(scratchRoot, "data", "osm", "uk");
  mkdirSync(scratchOsmDir, { recursive: true });
  cpSync(
    join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json"),
    join(scratchOsmDir, "uk_osm_pubs.json"),
  );
  for (const file of [
    "pint_prices_canonical_enriched.csv",
    "borough_embedded_pint_prices.csv",
    "pub_page_pint_prices.csv",
    "pint_prices_app_dataset.csv",
    "postcode_coordinate_exceptions.json",
    "postcode_coordinate_quarantine.json",
    "postcode_coordinate_corrections.json",
    "postcode_coordinate_build_report.json",
  ]) {
    cpSync(
      join(ROOT, "data", file),
      join(scratchRoot, "data", file),
    );
  }
  for (const file of ["bars.json", "late_food.json", "restaurants.json"]) {
    cpSync(
      join(ROOT, "data", "famous_venues", file),
      join(scratchFamousVenues, file),
    );
  }
  mkdirSync(join(scratchData, "weather"), { recursive: true });
  cpSync(
    join(ROOT, "public", "data", "weather", "latest.json"),
    join(scratchData, "weather", "latest.json"),
  );
  for (const f of ["venue_detail_index.json", "venue_details.jsonl"]) {
    cpSync(join(ROOT, "data", "generated", f), join(scratchGeneratedData, f));
  }
  const drinkDir = join(scratchData, "drink_price_updates");
  mkdirSync(drinkDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(drinkDir, name), JSON.stringify(body), "utf8");
  }
  return scratchScripts;
}

function runValidate(scriptsDir: string): { code: number; stdout: string } {
  try {
    const stdout = execFileSync("node", ["validate-data.mjs"], {
      cwd: scriptsDir,
      encoding: "utf8",
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { code: e.status, stdout: e.stdout };
  }
}

function injectLincolnArmsContradiction(scriptsDir: string) {
  const datasetPath = join(
    scriptsDir,
    "..",
    "public",
    "data",
    "pint_prices_app_dataset.json",
  );
  const rows = JSON.parse(readFileSync(datasetPath, "utf8"));
  rows[0] = {
    ...rows[0],
    pub_name: "The Lincoln Arms",
    address: "EN1 1QT",
    latitude: 51.5332,
    longitude: -0.1222,
  };
  writeFileSync(datasetPath, JSON.stringify(rows), "utf8");
  return rows[0] as {
    app_price_id: string;
    pub_name: string;
    address: string;
    latitude: number;
    longitude: number;
  };
}

function injectReassignedLincolnQuarantineLeak(scriptsDir: string) {
  const registry = JSON.parse(
    readFileSync(
      join(
        scriptsDir,
        "..",
        "data",
        "postcode_coordinate_quarantine.json",
      ),
      "utf8",
    ),
  );
  const lincoln = registry.rows.find(
    (entry: { appPriceId: string }) =>
      entry.appPriceId === "app_price_000339",
  );
  const datasetPath = join(
    scriptsDir,
    "..",
    "public",
    "data",
    "pint_prices_app_dataset.json",
  );
  const rows = JSON.parse(readFileSync(datasetPath, "utf8"));
  rows.push({
    ...rows[0],
    app_price_id: "app_price_reassigned",
    pub_name: lincoln.pubName,
    address: `155 Percival Road, Enfield ${lincoln.postcode}, UK`,
    latitude: lincoln.latitude + 0.00000005,
    longitude: lincoln.longitude - 0.00000005,
  });
  writeFileSync(datasetPath, JSON.stringify(rows), "utf8");
}

function writePostcodeCoordinateExceptions(
  scriptsDir: string,
  exceptions: unknown[],
) {
  writeFileSync(
    join(
      scriptsDir,
      "..",
      "data",
      "postcode_coordinate_exceptions.json",
    ),
    JSON.stringify({ exceptions }),
    "utf8",
  );
}

function writePubmaxxingSnapshotWithAlcoholBuckets(
  scriptsDir: string,
  counts: { alcoholic: number; nonAlcoholic: number; unknown: number },
) {
  const snapshotPath = join(scriptsDir, "..", "public", "data", "pubmaxxing_seed_snapshot.json");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const template = snapshot.beverages[0];
  if (!template) throw new Error("pubmaxxing fixture must contain at least one beverage row");
  snapshot.beverages = [
    ...Array.from({ length: counts.alcoholic }, (_, i) => ({
      ...template,
      priceId: `test-alcoholic-${i}`,
      isAlcoholic: true,
    })),
    ...Array.from({ length: counts.nonAlcoholic }, (_, i) => ({
      ...template,
      priceId: `test-non-alcoholic-${i}`,
      isAlcoholic: false,
    })),
    ...Array.from({ length: counts.unknown }, (_, i) => ({
      ...template,
      priceId: `test-unknown-${i}`,
      isAlcoholic: null,
    })),
  ];
  snapshot.summary = {
    ...snapshot.summary,
    pubs: snapshot.pubs.length,
    beverageRows: snapshot.beverages.length,
    alcoholicRows: counts.alcoholic,
    nonAlcoholicRows: counts.nonAlcoholic,
    unknownAlcoholicRows: counts.unknown,
    historySeeds: snapshot.historySeeds.length,
    discountMentions: snapshot.discountMentions.length,
    uniquePubIds: new Set(
      [
        ...snapshot.pubs.map((row: { pubId?: string }) => row.pubId),
        ...snapshot.beverages.map((row: { pubId?: string }) => row.pubId),
      ].filter(Boolean),
    ).size,
  };
  writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const GOOD_ROW = {
  venueKey: "the test arms|1 test street|51.50000|-0.10000",
  drinkName: "Doom Bar",
  category: "beer",
  priceGbp: 5.29,
  source: {
    label: "J D Wetherspoon — official site",
    url: "https://www.jdwetherspoon.com/pubs/all-pubs/the-test-arms",
    licence: "All rights reserved — first-party publisher, attributed use only.",
  },
  observedAt: "2020-01-01T00:00:00.000Z",
};

describe("validate-data.mjs drink-price-update extension", () => {
  it("passes with no drink_price_updates files present", () => {
    const scriptsDir = setupScratch({});
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("SKIP public/data/drink_price_updates/: no .json files present");
  });

  it("validates an official-publisher Pint Index source without relying on empty coverage", () => {
    const scriptsDir = setupScratch({});
    const snapshotPath = join(scriptsDir, "..", "public", "data", "pint_index_snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.status = "partial";
    snapshot.observationWindow = {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-15T23:59:59.000Z",
    };
    snapshot.sources = [{
      id: "official-pub-1",
      kind: "official_publisher",
      publisher: "Example Pub",
      publisherType: "pub",
      officialDomain: "example.com",
      sourceUrl: "https://www.example.com/drinks",
      licence: null,
    }];
    snapshot.observations = [{
      venueId: "venue-example",
      pubName: "Example Pub",
      boroughCode: "hackney",
      boroughName: "Hackney",
      pricePence: 600,
      observedAt: "2026-07-10T12:00:00.000Z",
      sourceId: "official-pub-1",
    }];
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS public/data/pint_index_snapshot.json: 1 public observations");
  });

  it("passes a well-formed drink-price-update file", () => {
    const scriptsDir = setupScratch({
      "prices_20200101.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [GOOD_ROW] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS public/data/drink_price_updates/prices_20200101.json: 1 rows, 0 error(s)");
  });

  it("accepts a bare top-level array too", () => {
    const scriptsDir = setupScratch({ "prices_20200101.json": [GOOD_ROW] });
    const { code } = runValidate(scriptsDir);
    expect(code).toBe(0);
  });

  it("FAILS (nonzero exit) when a row is missing a permissible source", () => {
    const badRow = { ...GOOD_ROW, source: undefined };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL public/data/drink_price_updates/prices_bad.json");
    expect(stdout).toContain("missing source");
  });

  it("FAILS when the source is missing a licence", () => {
    const badRow = { ...GOOD_ROW, source: { label: "X", url: "https://example.com" } };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("missing/empty source.licence");
  });

  it("FAILS when observedAt is in the future (never present stale-or-fake as live)", () => {
    const futureRow = { ...GOOD_ROW, observedAt: "2099-01-01T00:00:00.000Z" };
    const scriptsDir = setupScratch({
      "prices_future.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [futureRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("is in the future");
  });

  it("FAILS on a non-http(s) source URL", () => {
    const badRow = { ...GOOD_ROW, source: { ...GOOD_ROW.source, url: "ftp://example.com" } };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("is not an absolute http(s) URL");
  });

  it("FAILS on a negative price", () => {
    const badRow = { ...GOOD_ROW, priceGbp: -1 };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("priceGbp must be a finite number");
  });

  it("FAILS on a category outside the closed drinks taxonomy", () => {
    // tea is not a DrinkCategory; coffee is in the closed taxonomy.
    const badRow = { ...GOOD_ROW, category: "tea" };
    const scriptsDir = setupScratch({
      "prices_bad.json": { version: 1, generatedAt: "2020-01-01T00:00:00.000Z", updates: [badRow] },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain('invalid category "tea"');
  });

  it("accepts coffee as a closed-taxonomy drink category", () => {
    const coffeeRow = {
      ...GOOD_ROW,
      drinkName: "Flat white",
      category: "coffee",
      priceGbp: 3.2,
    };
    const scriptsDir = setupScratch({
      "prices_coffee.json": {
        version: 1,
        generatedAt: "2020-01-01T00:00:00.000Z",
        updates: [coffeeRow],
      },
    });
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain(
      "PASS public/data/drink_price_updates/prices_coffee.json: 1 rows, 0 error(s)",
    );
  });

  it("FAILS when the file is not valid JSON", () => {
    const scriptsDir = setupScratch({});
    // Overwrite with malformed JSON directly (setupScratch only writes valid JSON).
    writeFileSync(join(scriptsDir, "..", "public", "data", "drink_price_updates", "prices_broken.json"), "{not json", "utf8");
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("could not read/parse");
  });
});

describe("validate-data.mjs slim venue index validation", () => {
  it("validates the shipped slim venue artifact against the full pint dataset", () => {
    const scriptsDir = setupScratch({});
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS public/data/venues_slim.json");
  });

  it("FAILS when the slim index does not match the full dataset ids", () => {
    const scriptsDir = setupScratch({});
    const slimPath = join(scriptsDir, "..", "public", "data", "venues_slim.json");
    const payload = JSON.parse(readFileSync(slimPath, "utf8")) as {
      revision: string;
      rows: Array<Record<string, unknown>>;
    };
    payload.rows[0] = { ...payload.rows[0], id: "venue-not-real" };
    writeFileSync(
      slimPath,
      JSON.stringify(payload),
      "utf8",
    );
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL public/data/venues_slim.json");
    expect(stdout).toContain("id is not present in rebuilt full-dataset index");
  });

  it("collects missing spatial shard errors without aborting during budget checks", () => {
    const scriptsDir = setupScratch({});
    const manifestPath = join(scriptsDir, "..", "public", "data", "venues_slim.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      shards: Array<{ core: boolean; url: string }>;
    };
    const missing = manifest.shards.find((shard) => !shard.core);
    if (!missing) throw new Error("fixture has no spatial shard");
    rmSync(
      join(scriptsDir, "..", "public", "data", missing.url.replace(/^\/data\//, "")),
      { force: true },
    );

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("could not read body");
    expect(stdout).toContain("DATA VALIDATION FAILED");
  });

  it("FAILS when same-count spatial shard bodies are swapped", () => {
    const scriptsDir = setupScratch({});
    const manifestPath = join(scriptsDir, "..", "public", "data", "venues_slim.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      shards: Array<{ core: boolean; count: number; url: string }>;
    };
    const groups = new Map<number, typeof manifest.shards>();
    for (const shard of manifest.shards) {
      if (shard.core) continue;
      const group = groups.get(shard.count) ?? [];
      group.push(shard);
      groups.set(shard.count, group);
    }
    const pair = [...groups.values()].find((group) => group.length >= 2);
    if (!pair) throw new Error("fixture has no same-count spatial shard pair");
    const firstPath = join(scriptsDir, "..", "public", "data", pair[0].url.replace(/^\/data\//, ""));
    const secondPath = join(scriptsDir, "..", "public", "data", pair[1].url.replace(/^\/data\//, ""));
    const first = readFileSync(firstPath, "utf8");
    const second = readFileSync(secondPath, "utf8");
    writeFileSync(firstPath, second, "utf8");
    writeFileSync(secondPath, first, "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("belongs to another cell");
  });

  it("FAILS when a shard row keeps its id but changes content", () => {
    const scriptsDir = setupScratch({});
    const manifestPath = join(scriptsDir, "..", "public", "data", "venues_slim.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      shards: Array<{ core: boolean; url: string }>;
    };
    const shard = manifest.shards.find((entry) => !entry.core);
    if (!shard) throw new Error("fixture has no spatial shard");
    const shardPath = join(scriptsDir, "..", "public", "data", shard.url.replace(/^\/data\//, ""));
    const payload = JSON.parse(readFileSync(shardPath, "utf8")) as {
      revision: string;
      rows: Array<Record<string, unknown>>;
    };
    payload.rows[0] = { ...payload.rows[0], name: "Wrong Arms" };
    writeFileSync(shardPath, JSON.stringify(payload), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("differs from monolith");
  });
});

describe("validate-data.mjs postcode-coordinate validation", () => {
  it("FAILS loudly on the exact Lincoln Arms Enfield and King's Cross contradiction", () => {
    const scriptsDir = setupScratch({});
    injectLincolnArmsContradiction(scriptsDir);

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("postcode-coordinate contradiction");
    expect(stdout).toContain("The Lincoln Arms");
    expect(stdout).toContain("EN1");
    expect(stdout).toContain("12.60 km exceeds 5 km");
  });

  it("applies only an exact documented exception", () => {
    const scriptsDir = setupScratch({});
    const row = injectLincolnArmsContradiction(scriptsDir);
    writePostcodeCoordinateExceptions(scriptsDir, [
      {
        appPriceId: row.app_price_id,
        pubName: row.pub_name,
        postcode: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        reason:
          "Verified boundary-site address whose entrance and postcode district are more than 5 km apart.",
      },
    ]);

    const { stdout } = runValidate(scriptsDir);

    expect(stdout).not.toContain("postcode-coordinate contradiction");
    expect(stdout).toContain("postcode-coordinate exceptions: 1 applied");
  });

  it("FAILS when an exception has no stated reason", () => {
    const scriptsDir = setupScratch({});
    const row = injectLincolnArmsContradiction(scriptsDir);
    writePostcodeCoordinateExceptions(scriptsDir, [
      {
        appPriceId: row.app_price_id,
        pubName: row.pub_name,
        postcode: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        reason: "",
      },
    ]);

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("invalid postcode-coordinate exception");
    expect(stdout).toContain("reason must contain at least 20 characters");
  });

  it("FAILS when a quarantine entry is deliberately stale", () => {
    const scriptsDir = setupScratch({});
    const registryPath = join(
      scriptsDir,
      "..",
      "data",
      "postcode_coordinate_quarantine.json",
    );
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.rows[0].appPriceId = "app_price_999999";
    writeFileSync(registryPath, JSON.stringify(registry), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("invalid postcode-coordinate quarantine");
    expect(stdout).toContain("stale build decision input");
    expect(stdout).toContain("postcode_coordinate_quarantine.json");
  });

  it("FAILS when a quarantined identity leaks under a reassigned id and expanded address", () => {
    const scriptsDir = setupScratch({});
    injectReassignedLincolnQuarantineLeak(scriptsDir);

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain(
      "app_price_000339 (The Lincoln Arms) reached the product dataset",
    );
  });

  it("FAILS when quarantine geography is no longer contradictory", () => {
    const scriptsDir = setupScratch({});
    const registryPath = join(
      scriptsDir,
      "..",
      "data",
      "postcode_coordinate_quarantine.json",
    );
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    const lincoln = registry.rows.find(
      (entry: { appPriceId: string }) =>
        entry.appPriceId === "app_price_000339",
    );
    lincoln.latitude = 51.6415276;
    lincoln.longitude = -0.0687715;
    writeFileSync(registryPath, JSON.stringify(registry), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("invalid postcode-coordinate quarantine");
    expect(stdout).toContain(
      "app_price_000339 is not a postcode-coordinate contradiction",
    );
  });

  it("FAILS partial, duplicate, and reasonless quarantine entries", () => {
    const scriptsDir = setupScratch({});
    const registryPath = join(
      scriptsDir,
      "..",
      "data",
      "postcode_coordinate_quarantine.json",
    );
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    registry.rows[0].reason = "";
    delete registry.rows[1].longitude;
    registry.rows.push({ ...registry.rows[2] });
    writeFileSync(registryPath, JSON.stringify(registry), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("reason must contain at least 20 characters");
    expect(stdout).toContain(
      "latitude and longitude must be finite numbers",
    );
    expect(stdout).toContain("duplicate appPriceId app_price_000274");
  });
});

describe("validate-data.mjs pubmaxxing seed validation", () => {
  it("FAILS when a beverage row uses an invalid isAlcoholic value", () => {
    const scriptsDir = setupScratch({});
    const snapshotPath = join(scriptsDir, "..", "public", "data", "pubmaxxing_seed_snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.beverages[0] = { ...snapshot.beverages[0], isAlcoholic: "maybe" };
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("isAlcoholic must be boolean, null, or omitted");
  });

  it("allows a small unclassified isAlcoholic bucket without rejecting a healthy beverage import", () => {
    const scriptsDir = setupScratch({});
    writePubmaxxingSnapshotWithAlcoholBuckets(scriptsDir, {
      alcoholic: 1250,
      nonAlcoholic: 100,
      unknown: 50,
    });

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(0);
    expect(stdout).toContain("PASS public/data/pubmaxxing_seed_snapshot.json");
  });

  it("FAILS when the unclassified isAlcoholic bucket is too large", () => {
    const scriptsDir = setupScratch({});
    writePubmaxxingSnapshotWithAlcoholBuckets(scriptsDir, {
      alcoholic: 1250,
      nonAlcoholic: 100,
      unknown: 151,
    });

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("unknown isAlcoholic rows 151 above ceiling");
  });

  it("FAILS when generated summary counts drift from the snapshot arrays", () => {
    const scriptsDir = setupScratch({});
    const snapshotPath = join(scriptsDir, "..", "public", "data", "pubmaxxing_seed_snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.summary = { ...snapshot.summary, beverageRows: snapshot.beverages.length + 1 };
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("summary.beverageRows must equal computed count");
  });
});

describe("validate-data.mjs artifact resilience (required vs optional)", () => {
  // Pins the crash this suite exists to prevent: validate-data.mjs runs in
  // EVERY production build (vercel.json buildCommand), so an artifact that
  // is genuinely optional at runtime must degrade the build to a named
  // WARN and exit 0, never crash or hard-fail it. See ARTIFACT_CLASSIFICATION
  // in scripts/validate-data.mjs for the full required/optional table.

  it("degrades to a named WARN (exit 0) when the postcode-coordinate reference data is missing, rather than failing the build", () => {
    const scriptsDir = setupScratch({});
    rmSync(join(scriptsDir, "..", "data", "postcode_coordinate_exceptions.json"));

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(0);
    expect(stdout).toContain("WARN postcode_coordinate_reference_data:");
    expect(stdout).toContain("degrading, not failing the build");
    expect(stdout).toContain("DATA VALIDATION PASSED");
  });

  it("degrades to a named WARN (exit 0) when the postcode-coordinate build-decision registries are missing, rather than crashing", () => {
    const scriptsDir = setupScratch({});
    // Originally reproduced crash: an uncaught ENOENT reading these files
    // during the rebuild-and-diff cross-check took the whole process down
    // instead of failing (or degrading) gracefully.
    rmSync(join(scriptsDir, "..", "data", "postcode_coordinate_quarantine.json"));
    rmSync(join(scriptsDir, "..", "data", "postcode_coordinate_corrections.json"));
    rmSync(join(scriptsDir, "..", "data", "postcode_coordinate_build_report.json"));

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(0);
    expect(stdout).toContain("WARN postcode_coordinate_build_decisions:");
    expect(stdout).toContain("degrading, not failing the build");
    expect(stdout).toContain("DATA VALIDATION PASSED");
  });

  it("degrades to a named WARN (exit 0) when the heritage famous-venues seed is missing, and still validates venues_slim.json and venue_details.jsonl clean", () => {
    const scriptsDir = setupScratch({});
    rmSync(join(scriptsDir, "..", "data", "famous_venues"), { recursive: true, force: true });

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(0);
    expect(stdout).toContain(
      "SKIP data/famous_venues/: directory does not exist (optional heritage enrichment)",
    );
    expect(stdout).toContain("WARN famous_venues_seed:");
    expect(stdout).toContain("degrading, not failing the build");
    expect(stdout).toContain("PASS public/data/venues_slim.json");
    expect(stdout).toContain("PASS data/generated/venue_details.jsonl");
    expect(stdout).toContain("DATA VALIDATION PASSED");
  });

  it("still hard-fails (exit 1) with a one-line named error and no raw stack trace when a REQUIRED artifact is missing", () => {
    const scriptsDir = setupScratch({});
    rmSync(join(scriptsDir, "..", "public", "data", "pint_prices_app_dataset.json"));

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("FAIL public/data/pint_prices_app_dataset.json:");
    expect(stdout).toContain("DATA VALIDATION FAILED");
    // No raw stack trace: a stack frame line looks like "    at ...".
    expect(stdout).not.toMatch(/^\s+at .+/m);
  });

  it("still catches a genuine defect in a later-validated artifact when the heritage seed is also missing, rather than truncating the run", () => {
    // cursorreview.md F14: the missing optional heritage seed must degrade
    // only its own famous_venues_seed check, never skip or shadow validation
    // of any other artifact. pubmaxxing_seed_snapshot.json runs last in
    // DATASET_RUNS, so a defect there is the strongest proof the run did not
    // stop early: every dataset between the missing heritage seed and this
    // one still had to execute for its own FAIL line to appear too.
    const scriptsDir = setupScratch({});
    rmSync(join(scriptsDir, "..", "data", "famous_venues"), { recursive: true, force: true });
    const snapshotPath = join(scriptsDir, "..", "public", "data", "pubmaxxing_seed_snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    snapshot.pubs[0] = { ...snapshot.pubs[0], pubId: "" };
    writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");

    const { code, stdout } = runValidate(scriptsDir);

    expect(code).toBe(1);
    expect(stdout).toContain("WARN famous_venues_seed:");
    expect(stdout).toContain("PASS public/data/venues_slim.json");
    expect(stdout).toContain("PASS data/generated/venue_details.jsonl");
    expect(stdout).toContain("FAIL public/data/pubmaxxing_seed_snapshot.json:");
    expect(stdout).toContain("pub 0: missing pubId");
    expect(stdout).toContain("DATA VALIDATION FAILED");
  });
});

describe("validate-data.mjs venue detail row validation", () => {
  it("validates the shipped lazy venue detail artifact against the full pint dataset", () => {
    const scriptsDir = setupScratch({});
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS data/generated/venue_details.jsonl");
  });

  it("FAILS when a detail row id does not match its grouped price rows", () => {
    const scriptsDir = setupScratch({});
    writeFileSync(
      join(scriptsDir, "..", "data", "generated", "venue_detail_index.json"),
      JSON.stringify({
        version: 1,
        detailsFile: "venue_details.jsonl",
        count: 1,
        venues: {
          "venue-not-real": {
            offset: 0,
            length: Buffer.byteLength(`${JSON.stringify({ id: "venue-not-real", rows: [] })}\n`),
            rowCount: 1,
          },
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(scriptsDir, "..", "data", "generated", "venue_details.jsonl"),
      `${JSON.stringify({ id: "venue-not-real", rows: [] })}\n`,
      "utf8",
    );
    const { code, stdout } = runValidate(scriptsDir);
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL data/generated/venue_details.jsonl");
    expect(stdout).toContain("id is not present in rebuilt full-dataset index");
  });
});
