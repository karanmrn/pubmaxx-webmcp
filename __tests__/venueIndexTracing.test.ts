// EVERY REQUEST-TIME DATA-PACK READER MUST SHIP THE FILES IT OPENS.
//
// lib/venueIndex.ts builds each city pack path from config at request time, and
// lib/venueDetailIndex.ts builds the detail manifest, rows and raw dataset paths
// the same way, so Next cannot discover those files from the reader bundle. A
// build may still contain them through incidental route grouping, but that is
// not a contract.
//
// Route discovery therefore follows local imports from App Router entries to
// each pack's modules (lib/venueIndexTracing.mjs RUNTIME_DATA_PACKS). This test
// pins three things independently: a synthetic import graph proves discovery
// follows helpers, converts route conventions and merges two packs on one
// route; every reader in the real graph must be represented in evaluated Next
// config; and no module may assemble a data path at request time on a route's
// import graph without being declared or carried as a named exception.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RUNTIME_DATA_PACKS,
  RUNTIME_PATH_MODULES_PENDING_DECLARATION,
  RUNTIME_PATH_MODULES_TRACED_ELSEWHERE,
  discoverRuntimePathModules,
  discoverRuntimeReaderRouteGlobs,
  runtimeDataPackRouteIncludes,
} from "@/lib/venueIndexTracing.mjs";
import { PINT_INDEX_SNAPSHOT_TRACING_INCLUDE } from "@/lib/pintIndexSnapshotFile.mjs";
import { CITY_VENUE_PACKS } from "@/lib/cityVenuePacks.mjs";
import { MAP_EAGER_VENUE_INDEX_TRACING_INCLUDE } from "@/lib/mapEagerVenueIndexFile.mjs";
import { VENUE_IMAGE_HOST_TRACING_INCLUDES } from "@/lib/venueImageHostFiles.mjs";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

const root = join(__dirname, "..");
const temporaryRoots: string[] = [];

function tracingIncludes(): Record<string, string[]> {
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

function writeFixture(relativePath: string, source: string): void {
  const fixtureRoot = temporaryRoots.at(-1);
  if (!fixtureRoot) throw new Error("fixture root missing");
  const file = join(fixtureRoot, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime data-pack tracing", () => {
  it("derives route globs by following local imports from App Router entries", () => {
    temporaryRoots.push(mkdtempSync(join(tmpdir(), "venue-index-tracing-")));

    writeFixture("lib/venueIndex.ts", "export async function getVenueIndex() {}");
    writeFixture(
      "components/serverVenue.ts",
      'import { getVenueIndex } from "@/lib/venueIndex";\nexport { getVenueIndex };\n',
    );
    writeFixture(
      "app/nested/reader.ts",
      'export { getVenueIndex } from "@/components/serverVenue";\n',
    );
    writeFixture(
      "app/nested/page.tsx",
      'import { getVenueIndex } from "./reader";\nexport default getVenueIndex;\n',
    );
    writeFixture(
      "app/api/direct/route.ts",
      'import { getVenueIndex } from "@/lib/venueIndex";\nexport const GET = getVenueIndex;\n',
    );
    writeFixture(
      "app/bar/[id]/opengraph-image.tsx",
      'import { getVenueIndex } from "@/lib/venueIndex";\nexport default getVenueIndex;\n',
    );
    writeFixture(
      "app/cyclic/a.ts",
      'import "./b";\nexport { getVenueIndex } from "@/lib/venueIndex";\n',
    );
    writeFixture("app/cyclic/b.ts", 'export * from "./a";\n');
    writeFixture("app/cyclic/page.tsx", 'export * from "./b";\n');
    writeFixture("app/unrelated/page.tsx", "export default function Page() { return null; }\n");

    expect(discoverRuntimeReaderRouteGlobs(temporaryRoots[0], "lib/venueIndex.ts")).toEqual([
      "/api/direct",
      "/bar/\\[id\\]/opengraph-image",
      "/cyclic",
      "/nested",
    ]);
  });

  it("declares every pack owned by each reader module", () => {
    temporaryRoots.push(mkdtempSync(join(tmpdir(), "venue-index-tracing-")));

    const venueIndexPack = RUNTIME_DATA_PACKS.find((pack) => pack.id === "venue-index");
    const venueDetailPack = RUNTIME_DATA_PACKS.find(
      (pack) => pack.id === "venue-detail-index",
    );
    if (!venueIndexPack || !venueDetailPack) throw new Error("venue tracing packs missing");
    const venueIndexModule = venueIndexPack.modules[0];
    const venueDetailModule = venueDetailPack.modules[0];
    writeFixture(venueIndexModule, "export async function getVenueIndex() {}");
    writeFixture(venueDetailModule, "export async function getVenueDetail() {}");
    writeFixture(
      "app/api/packs/route.ts",
      `import "@/${venueIndexModule.replace(/\.ts$/, "")}";\n` +
        `import "@/${venueDetailModule.replace(/\.ts$/, "")}";\n`,
    );
    writeFixture(
      "app/detail/page.tsx",
      `import "@/${venueDetailModule.replace(/\.ts$/, "")}";\n` +
        "export default function Page() { return null; }\n",
    );

    const includes = runtimeDataPackRouteIncludes(temporaryRoots[0]);

    expect(new Set(Object.keys(includes))).toEqual(new Set(["/api/packs", "/detail"]));
    const expectedFiles = new Set([...venueIndexPack.files, ...venueDetailPack.files]);
    expect(new Set(includes["/api/packs"])).toEqual(expectedFiles);
    expect(new Set(includes["/detail"])).toEqual(expectedFiles);
  });

  it("declares every pack file for every discovered runtime reader of that pack", () => {
    const includes = tracingIncludes();

    expect(RUNTIME_DATA_PACKS.length).toBeGreaterThan(0);
    for (const pack of RUNTIME_DATA_PACKS) {
      expect(pack.modules.length, `${pack.id} must name its modules`).toBeGreaterThan(0);
      expect(pack.files.length, `${pack.id} must declare files`).toBeGreaterThan(0);
      for (const packModule of pack.modules) {
        const routes = discoverRuntimeReaderRouteGlobs(root, packModule);

        expect(routes.length, `${packModule} must have runtime readers`).toBeGreaterThan(0);
        for (const route of routes) {
          expect(includes[route], `${route} must declare ${pack.id} files`).toBeDefined();
          for (const file of pack.files) {
            expect(includes[route], `${route} is missing ${file}`).toContain(file);
          }
        }
      }
    }
  });

  it("keeps OSM packs off base-only venue routes", () => {
    const includes = tracingIncludes();
    const osmPack = RUNTIME_DATA_PACKS.find((pack) => pack.id === "venue-osm-index");

    expect(osmPack).toBeDefined();
    for (const file of osmPack?.files ?? []) {
      expect(includes["/api/wanted"]).not.toContain(file);
      expect(includes["/api/harvest-overlay"]).toContain(file);
    }
  });

  it("carries the shared Pint Price reader to the landing pages and the sitemap", () => {
    const pack = RUNTIME_DATA_PACKS.find(
      (candidate) => candidate.id === "pint-price-landing-dataset",
    );
    expect(pack).toEqual({
      id: "pint-price-landing-dataset",
      modules: ["lib/pintPriceLandingDataset.server.ts"],
      files: ["./public/data/pint_prices_app_dataset.json"],
    });

    const routes = discoverRuntimeReaderRouteGlobs(
      root,
      "lib/pintPriceLandingDataset.server.ts",
    );
    expect(routes).toEqual(
      expect.arrayContaining([
        "/drink/\\[slug\\]",
        "/drink/\\[slug\\]/opengraph-image",
        "/area/\\[slug\\]/drink/\\[brand\\]",
        "/area/\\[slug\\]/drink/\\[brand\\]/opengraph-image",
        "/sitemap.xml",
      ]),
    );

    const includes = tracingIncludes();
    for (const route of routes) {
      expect(includes[route]).toContain("./public/data/pint_prices_app_dataset.json");
    }
  });

  it("ships the map's eager shard to the pages that link a pub into the map", () => {
    const routes = discoverRuntimeReaderRouteGlobs(
      root,
      "lib/mapEagerVenueIndex.server.ts",
    );
    expect(routes).toEqual(
      expect.arrayContaining([
        "/drink/\\[slug\\]",
        "/area/\\[slug\\]/drink/\\[brand\\]",
      ]),
    );

    const includes = tracingIncludes();
    for (const route of routes) {
      expect(includes[route]).toContain(MAP_EAGER_VENUE_INDEX_TRACING_INCLUDE);
    }
  });

  it("traces the image-proxy allowlist datasets without widening other routes", () => {
    const includes = tracingIncludes();

    expect(includes["/api/image-proxy"]).toEqual(VENUE_IMAGE_HOST_TRACING_INCLUDES);
  });

  it("ships the public Pint Index snapshot with the About page", () => {
    const includes = tracingIncludes();

    expect(includes["/about"]).toContain(PINT_INDEX_SNAPSHOT_TRACING_INCLUDE);
  });

  it("ships non-London slim packs to every venue-detail reader", () => {
    const oxfordPack = "./public/data/cities/oxford/venues_slim.json";
    const oxfordVenues = (rowsFromSlimPayload(
      JSON.parse(readFileSync(join(root, oxfordPack.slice(2)), "utf8")),
    ) ?? []) as Array<{ id: string }>;
    expect(oxfordVenues.some((venue) => venue.id === "venue-oxf-16404bl")).toBe(true);

    const includes = tracingIncludes();
    for (const route of [
      "/api/venue/\\[id\\]",
      "/api/plans/\\[id\\]/getin",
      "/api/plans/anchor",
      "/recap/\\[storyId\\]",
    ]) {
      expect(includes[route], `${route} must ship the Oxford pack`).toContain(oxfordPack);
    }
  });

  it("ships every file referenced by active map manifests", () => {
    const manifests = [
      join(root, "public", "data", "uk_base", "manifest.json"),
      ...Object.entries(CITY_VENUE_PACKS)
        .filter(([cityId, pack]) => pack.enabled && cityId !== "london")
        .map(([, pack]) =>
          join(
            root,
            "public",
            pack.slimVenuesPath
              .replace(/^\//, "")
              .replace(/\.json$/, ".manifest.json"),
          ),
        ),
    ];

    for (const manifestPath of manifests) {
      expect(existsSync(manifestPath), `${manifestPath} must be committed`).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        urlPrefix?: string;
        shards?: Array<{ id?: string; url?: string }>;
      };
      expect(Array.isArray(manifest.shards), `${manifestPath} must list shards`).toBe(true);

      for (const shard of manifest.shards ?? []) {
        const url =
          typeof shard.url === "string"
            ? shard.url
            : `${manifest.urlPrefix ?? ""}${shard.id ?? ""}.json`;
        const assetPath = join(root, "public", url.replace(/^\//, ""));
        expect(existsSync(assetPath), `${manifestPath} references missing ${url}`).toBe(true);
      }
    }
  });

  it("flags a module that opens a path it assembled, and ignores a literal one", () => {
    temporaryRoots.push(mkdtempSync(join(tmpdir(), "venue-index-tracing-")));

    writeFixture(
      "lib/assembled.ts",
      'import { readFile } from "node:fs/promises";\n' +
        'import path from "node:path";\n' +
        'import { FILE } from "@/lib/fileName";\n' +
        "export const read = () => readFile(path.join(process.cwd(), FILE), \"utf8\");\n",
    );
    writeFixture("lib/fileName.ts", 'export const FILE = "public/data/thing.json";\n');
    writeFixture(
      "lib/literal.ts",
      'import { readFile } from "node:fs/promises";\n' +
        'import path from "node:path";\n' +
        'export const read = () =>\n' +
        '  readFile(path.join(process.cwd(), "public", "data", "fixed.json"), "utf8");\n',
    );
    writeFixture(
      "lib/unreachable.ts",
      'import { readFile } from "node:fs/promises";\n' +
        'import path from "node:path";\n' +
        'export const read = (name: string) => readFile(path.join(process.cwd(), name), "utf8");\n',
    );
    writeFixture(
      "lib/resolved.ts",
      'import { readFile } from "node:fs/promises";\n' +
        'import path from "node:path";\n' +
        'import { FILE } from "@/lib/fileName";\n' +
        'export const read = () => readFile(path.resolve(process.cwd(), FILE), "utf8");\n',
    );
    writeFixture(
      "lib/templated.ts",
      'import { readFile } from "node:fs/promises";\n' +
        'import { FILE } from "@/lib/fileName";\n' +
        "export const read = () => readFile(`${process.cwd()}/public/${FILE}`, \"utf8\");\n",
    );
    writeFixture(
      "lib/templatedLiteral.ts",
      'import { readFile } from "node:fs/promises";\n' +
        "export const read = () =>\n" +
        "  readFile(`${process.cwd()}/public/data/fixed.json`, \"utf8\");\n",
    );
    writeFixture(
      "app/reader/page.tsx",
      'import "@/lib/assembled";\nimport "@/lib/literal";\nimport "@/lib/resolved";\n' +
        'import "@/lib/templated";\nimport "@/lib/templatedLiteral";\n' +
        "export default function Page() { return null; }\n",
    );

    expect(discoverRuntimePathModules(temporaryRoots[0])).toEqual([
      "lib/assembled.ts",
      "lib/resolved.ts",
      "lib/templated.ts",
    ]);
  });

  it("accounts for every runtime-assembled data read a route can reach", () => {
    const modules = discoverRuntimePathModules(root);
    const inPacks = new Set(RUNTIME_DATA_PACKS.flatMap((pack) => pack.modules));

    expect(modules.length).toBeGreaterThan(0);
    for (const found of modules) {
      const accounted =
        inPacks.has(found) ||
        found in RUNTIME_PATH_MODULES_TRACED_ELSEWHERE ||
        found in RUNTIME_PATH_MODULES_PENDING_DECLARATION;
      expect(
        accounted,
        `${found} assembles a data path at request time, so it must be a RUNTIME_DATA_PACK ` +
          "module, named in RUNTIME_PATH_MODULES_TRACED_ELSEWHERE, or carried in " +
          "RUNTIME_PATH_MODULES_PENDING_DECLARATION with what it opens",
      ).toBe(true);
    }

    // The two exception lists may only shrink: nothing in them may be stale, and
    // a module that has since been declared must leave the pending list.
    for (const excepted of [
      ...Object.keys(RUNTIME_PATH_MODULES_TRACED_ELSEWHERE),
      ...Object.keys(RUNTIME_PATH_MODULES_PENDING_DECLARATION),
    ]) {
      expect(modules, `${excepted} no longer assembles a runtime path`).toContain(excepted);
      expect(inPacks.has(excepted), `${excepted} is declared, so drop its exception`).toBe(false);
    }
    for (const reason of Object.values(RUNTIME_PATH_MODULES_PENDING_DECLARATION)) {
      expect(reason.length, "a pending module must say what it opens").toBeGreaterThan(0);
    }
  });
});
