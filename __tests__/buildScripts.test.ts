import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

const ROOT = path.join(__dirname, "..");
const BUILD_PUBMAXXING_SCRIPT = path.join(ROOT, "scripts", "build_pubmaxxing_seed.mjs");

const tempDirs: string[] = [];

function writePubmaxxingFixture(root: string) {
  const sourceDir = path.join(root, "data", "pubmaxxing");
  mkdirSync(path.join(sourceDir, "area-expansion"), { recursive: true });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  cpSync(BUILD_PUBMAXXING_SCRIPT, path.join(root, "scripts", "build_pubmaxxing_seed.mjs"));
  writeFileSync(
    path.join(sourceDir, "source.json"),
    JSON.stringify({
      sourceRepo: "https://github.com/karanmrn/pubmaxxing",
      sourceCommit: "6eafc34",
      importedAt: "2026-07-07",
      notes: "fixture",
    }),
  );
  writeFileSync(
    path.join(sourceDir, "london_pubs_expanded.csv"),
    [
      "rank,pub_id,pub_name,chain_name,area,full_address,rating,review_count,price_tier,venue_tags,venue_url,menu_url,discovery_source_name,discovery_source_url,discovered_at,notes",
      "1,pub-1,Fixture Arms,Fixture,Soho,1 Test St,4.1,12,££,Pub,not a url,https://fixture.example/menu,Directory,Directory page 7,2026-07-07T00:00:00.000Z,Fixture row",
    ].join("\n"),
  );
  writeFileSync(
    path.join(sourceDir, "london_pub_all_beverages_expanded.csv"),
    [
      "beverage_type,run_id,price_id,pub_id,pub_name,rank,chain_name,area,website,source_url,source_type,menu_page_title,beverage_category,beverage_subcategory,beverage_name,serving_size,unit_volume_ml,abv,is_alcoholic,base_price_gbp,price_options_gbp,bottle_price_gbp,happy_hour_price_gbp,discount_type,discount_desc,discount_days,discount_time_range,currency,price_observed_date,source_observed_at,parse_confidence,raw_context,parser_version",
      "unknown,run-1,price-1,pub-1,Fixture Arms,1,Fixture,Soho,fixture.example,not a url,menu,Fixture Menu,Beer,Lager,Fixture Lager,pint,568,,maybe,5.20,,,,,,,GBP,2026-07-07,2026-07-07T00:00:00.000Z,0.8,raw,v1",
    ].join("\n"),
  );
  writeFileSync(
    path.join(sourceDir, "london_pub_history_seed.csv"),
    [
      "pub_id,pub_name,area,history_query,source_title,source_url,source_description,source_position,observed_at,kg_subject,kg_predicate,kg_object,confidence,notes",
      "pub-1,Fixture Arms,Soho,query,Fixture History,https://fixture.example/history,desc,1,2026-07-07T00:00:00.000Z,pub:pub-1,has_history_source,https://fixture.example/history,medium,valid",
      "pub-2,Broken Arms,Soho,query,Broken History,https://fixture.example/broken,desc,2,2026-07-07T00:00:00.000Z,pub:pub-2,has_history_source,not a url,medium,skip",
    ].join("\n"),
  );
  writeFileSync(
    path.join(sourceDir, "london_pub_discount_mentions.csv"),
    [
      "run_id,pub_id,pub_name,rank,source_url,discount_type,discount_desc,discount_days,discount_time_range,source_observed_at,raw_context",
      "run-1,pub-1,Fixture Arms,1,not a url,offer,fixture offer,Monday,17:00-19:00,2026-07-07T00:00:00.000Z,raw",
    ].join("\n"),
  );
  writeFileSync(
    path.join(sourceDir, "area-expansion", "london_pub_discount_mentions.csv"),
    [
      "run_id,pub_id,pub_name,rank,source_url,discount_type,discount_desc,discount_days,discount_time_range,source_observed_at,raw_context",
      "run-2,pub-1,Fixture Arms,2,https://fixture.example/offers,offer,fixture offer,Tuesday,17:00-19:00,2026-07-07T00:00:00.000Z,raw",
    ].join("\n"),
  );
}

function runPubmaxxingSeedBuild(root: string) {
  const result = spawnSync("node", ["build_pubmaxxing_seed.mjs"], {
    cwd: path.join(root, "scripts"),
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`build_pubmaxxing_seed.mjs failed:\n${result.stdout}\n${result.stderr}`);
  }
  const snapshot = JSON.parse(
    readFileSync(path.join(root, "public", "data", "pubmaxxing_seed_snapshot.json"), "utf8"),
  );
  return { stderr: result.stderr, snapshot };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("build scripts", () => {
  it("regenerates bundled data artifacts before the production build", () => {
    expect(packageJson.scripts?.prebuild).toBe(
      "npm run prepare:maplibre-worker && npm run build:slim && npm run build:city-slim && npm run build:pubmaxxing-seed && npm run build:uk-base",
    );
  });

  it("regenerates bundled data artifacts before data validation", () => {
    expect(packageJson.scripts?.["prevalidate-data"]).toBe(
      "npm run build:slim && npm run build:city-slim && npm run build:pubmaxxing-seed && npm run build:uk-base",
    );
  });

  it("regenerates the UK place search index with the UK base layer", () => {
    expect(packageJson.scripts?.["build:uk-base"]).toBe(
      "node scripts/build_uk_base_shards.mjs && node scripts/build_uk_place_index.mjs && node scripts/build_uk_pub_search_index.mjs",
    );
  });

  it("omits malformed optional URLs and skips rows with malformed critical URLs", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pubmaxxing-seed-test-"));
    tempDirs.push(root);
    writePubmaxxingFixture(root);

    const { stderr, snapshot } = runPubmaxxingSeedBuild(root);

    expect(stderr).toContain("pub venue_url row 2");
    expect(stderr).toContain("beverage source_url row 2");
    expect(stderr).toContain("history kg_object row 3");
    expect(stderr).toContain("discount source_url row 2");
    expect(snapshot.pubs).toHaveLength(1);
    expect(snapshot.pubs[0].venueUrl).toBeUndefined();
    expect(snapshot.pubs[0].discoverySourceUrl).toBeUndefined();
    expect(snapshot.pubs[0].discoverySourceRef).toBe("Directory page 7");
    expect(snapshot.beverages).toHaveLength(1);
    expect(snapshot.beverages[0].sourceUrl).toBeUndefined();
    expect(snapshot.historySeeds).toHaveLength(1);
    expect(snapshot.discountMentions).toHaveLength(1);
    expect(snapshot.summary.unknownAlcoholicRows).toBe(1);
  });

  it("names the pubmaxxing source import timestamp explicitly", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pubmaxxing-seed-test-"));
    tempDirs.push(root);
    writePubmaxxingFixture(root);

    const { snapshot } = runPubmaxxingSeedBuild(root);

    expect(snapshot.sourceImportedAt).toBe("2026-07-07");
    expect(snapshot.generatedAt).toBeUndefined();
  });
});
