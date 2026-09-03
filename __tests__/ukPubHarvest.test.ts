import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { QUERY_TIMEOUT_S } from "../scripts/lib/overpassClient.mjs";
import { UK_AREA_ID } from "../scripts/lib/ukOsmSeed.mjs";
import {
  EXA_CONTENTS_URL,
  EXA_DEPRECATED_PARAM_KEYS,
  EXA_PUB_OUTPUT_SCHEMA,
  EXA_SEARCH_URL,
  EXA_SYSTEM_PROMPT,
  ODBL_ATTRIBUTION,
  ODBL_LICENSE,
  SHARD_SIZE,
  backoffMs,
  buildExaContentsBody,
  buildExaSearchBody,
  buildHarvestOverpassQuery,
  classifyExaHit,
  createExaClient,
  enrichPub,
  enrichPubWithClient,
  estimateEta,
  groundedMenuUrls,
  harvestSearchQuery,
  isMainModule,
  isPlainBar,
  isPubLikeBar,
  pubsEnrichComplete,
  loadProgress,
  mockExaPayload,
  nextShardIndex,
  normalizeHarvestElements,
  observationsFromExaOutput,
  observationsFromExaResults,
  officialWebsiteUrl,
  osmObjectUrl,
  persistedShardRowCount,
  readJsonl,
  seedRowFromElement,
  shardFileName,
  writeJsonlAtomic,
  writeProgress,
  writeShardAtomic,
} from "../scripts/lib/ukPubHarvest.mjs";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tmp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uk-pub-harvest-"));
  tmpDirs.push(dir);
  return dir;
}

function element(overrides: Record<string, unknown> = {}) {
  return {
    type: "node",
    id: 42,
    lat: 51.5,
    lon: -0.1,
    tags: { amenity: "pub", name: "The Test Arms", ...(overrides.tags as object) },
    ...overrides,
  };
}

describe("UK pub harvest Overpass query", () => {
  it("asks for amenity=pub and amenity=bar, clipped to the UK area, with the shared timeout", () => {
    const query = buildHarvestOverpassQuery([50.8, -0.7, 51.8, 0.3]);
    expect(query).toContain(`[timeout:${QUERY_TIMEOUT_S}]`);
    expect(query).toContain(`area(id:${UK_AREA_ID})->.uk;`);
    expect(query).toContain('node["amenity"="pub"](area.uk)(50.8,-0.7,51.8,0.3);');
    expect(query).toContain('way["amenity"="pub"](area.uk)(50.8,-0.7,51.8,0.3);');
    expect(query).toContain('node["amenity"="bar"](area.uk)(50.8,-0.7,51.8,0.3);');
    expect(query).toContain('way["amenity"="bar"](area.uk)(50.8,-0.7,51.8,0.3);');
    expect(query.trimEnd().endsWith("out center tags;")).toBe(true);
  });
});

describe("pub-like bar gate", () => {
  it("keeps a bar only when OSM states real ale, a microbrewery, or a brewery", () => {
    expect(isPubLikeBar({ amenity: "bar" })).toBe(false);
    expect(isPubLikeBar({ amenity: "bar", real_ale: "yes" })).toBe(true);
    expect(isPubLikeBar({ amenity: "bar", microbrewery: "yes" })).toBe(true);
    expect(isPubLikeBar({ amenity: "bar", brewery: "Kernel" })).toBe(true);
    expect(isPubLikeBar({ amenity: "pub" })).toBe(false);
  });

  it("does not infer pub-like from a name", () => {
    expect(isPubLikeBar({ amenity: "bar", name: "The Red Lion Pub" })).toBe(false);
  });

  it("names a plain bar as amenity=bar that is not pub-like", () => {
    expect(isPlainBar({ amenity: "bar" })).toBe(true);
    expect(isPlainBar({ amenity: "bar", name: "The Vault" })).toBe(true);
    expect(isPlainBar({ amenity: "bar", real_ale: "yes" })).toBe(false);
    expect(isPlainBar({ amenity: "pub" })).toBe(false);
  });
});

describe("plain-bars harvest lane", () => {
  const fetchedAt = "2026-08-25T12:00:00.000Z";

  it("keeps a named plain bar and drops pubs and pub-like bars", () => {
    const { rows, drops } = normalizeHarvestElements(
      [
        element({ tags: { amenity: "bar", name: "The Vault" } }),
        element({ id: 2, tags: { amenity: "pub", name: "The Test Arms" } }),
        element({ id: 3, tags: { amenity: "bar", name: "Ale House", real_ale: "yes" } }),
        element({ id: 4, tags: { amenity: "bar" } }),
      ],
      { fetchedAt, lane: "plain-bars" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      osmId: "node/42",
      name: "The Vault",
      amenity: "bar",
      license: ODBL_LICENSE,
      attribution: ODBL_ATTRIBUTION,
      sourceUrl: "https://www.openstreetmap.org/node/42",
    });
    expect(drops.pubOrPubLike).toBe(2);
    expect(drops.unnamed).toBe(1);
  });

  it("asks Exa for a UK bar, not a UK pub", () => {
    expect(
      harvestSearchQuery({
        name: "The Vault",
        amenity: "bar",
        addressTags: { "addr:city": "Manchester" },
      } as never),
    ).toBe("The Vault Manchester UK bar official website history");
  });

  it("treats pubs enrich as complete only when the count meets the seed", () => {
    expect(pubsEnrichComplete({ stage: "enrich", seedCount: 38215, enrichedCount: 26300 })).toBe(false);
    expect(pubsEnrichComplete({ stage: "enrich", seedCount: 38215, enrichedCount: 38215 })).toBe(true);
    expect(pubsEnrichComplete({ stage: "done", seedCount: 38215, enrichedCount: 38215, mock: false })).toBe(
      true,
    );
    expect(pubsEnrichComplete({ stage: "done", seedCount: 20, enrichedCount: 20, mock: true })).toBe(false);
  });

  it("matches the running script through pathToFileURL", () => {
    expect(isMainModule("file:///tmp/uk%20pubs/run.mjs", "/tmp/uk pubs/run.mjs")).toBe(true);
    expect(isMainModule("file:///tmp/uk%20pubs/run.mjs", "/tmp/other.mjs")).toBe(false);
    expect(isMainModule("file:///tmp/run.mjs", "")).toBe(false);
  });
});

describe("seed row from an OSM element", () => {
  const fetchedAt = "2026-08-25T12:00:00.000Z";

  it("carries osm id, name, point, stated address and social tags, and ODbL provenance", () => {
    const row = seedRowFromElement(
      element({
        tags: {
          amenity: "pub",
          name: "The Test Arms",
          "addr:housenumber": "12",
          "addr:street": "High Street",
          "addr:city": "London",
          "addr:postcode": "E1 6AN",
          website: "https://thetestarms.example/",
          "contact:instagram": "thetestarms",
          "contact:facebook": "https://www.facebook.com/thetestarms",
        },
      }),
      { fetchedAt },
    );
    expect(row).toMatchObject({
      osmId: "node/42",
      name: "The Test Arms",
      amenity: "pub",
      lat: 51.5,
      lng: -0.1,
      license: ODBL_LICENSE,
      attribution: ODBL_ATTRIBUTION,
      sourceUrl: "https://www.openstreetmap.org/node/42",
      fetchedAt,
    });
    expect(row?.addressTags).toEqual({
      "addr:housenumber": "12",
      "addr:street": "High Street",
      "addr:city": "London",
      "addr:postcode": "E1 6AN",
    });
    expect(row?.website).toEqual({
      value: "https://thetestarms.example/",
      sourceUrl: "https://www.openstreetmap.org/node/42",
      fetchedAt,
    });
    expect(row?.socialTags).toEqual({
      instagram: {
        value: "thetestarms",
        sourceUrl: "https://www.openstreetmap.org/node/42",
        fetchedAt,
      },
      facebook: {
        value: "https://www.facebook.com/thetestarms",
        sourceUrl: "https://www.openstreetmap.org/node/42",
        fetchedAt,
      },
    });
  });

  it("drops unnamed elements and elements with no point", () => {
    expect(seedRowFromElement(element({ tags: { amenity: "pub" } }), { fetchedAt })).toBeNull();
    expect(
      seedRowFromElement(element({ lat: undefined, lon: undefined, center: undefined }), { fetchedAt }),
    ).toBeNull();
  });

  it("keeps a pub-like bar and drops a plain bar", () => {
    const bar = seedRowFromElement(
      element({ id: 7, tags: { amenity: "bar", name: "Ale House", real_ale: "yes" } }),
      { fetchedAt },
    );
    expect(bar?.amenity).toBe("bar");
    expect(bar?.osmId).toBe("node/7");
    expect(
      seedRowFromElement(element({ tags: { amenity: "bar", name: "Cocktail Bar" } }), { fetchedAt }),
    ).toBeNull();
  });

  it("builds the OSM object URL from type and id", () => {
    expect(osmObjectUrl("way", 234967160)).toBe("https://www.openstreetmap.org/way/234967160");
  });
});

describe("Exa observations", () => {
  const fetchedAt = "2026-08-25T12:00:00.000Z";
  const pub = {
    osmId: "node/42",
    name: "The Test Arms",
    lat: 51.5,
    lng: -0.1,
  };

  it("stores website, history snippets, social handles, menu URLs and coverage only when a sourceUrl is present", () => {
    const observations = observationsFromExaResults(pub, [
      {
        url: "https://thetestarms.example/",
        title: "The Test Arms",
        text: "Our pub has poured cask ale on Brick Lane since 1842.",
      },
      {
        url: "https://www.instagram.com/thetestarms",
        title: "Instagram",
      },
      {
        url: "https://thetestarms.example/menus/drinks",
        title: "Drinks menu",
      },
      {
        url: "https://www.theguardian.com/lifeandstyle/the-test-arms-review",
        title: "A night at The Test Arms",
        text: "The Test Arms remains a proper East End pub.",
      },
    ], fetchedAt);

    expect(observations.every((row) => row.sourceUrl && row.fetchedAt === fetchedAt)).toBe(true);
    expect(observations.map((row) => row.kind).sort()).toEqual(
      ["coverage", "history", "menu", "social", "website"].sort(),
    );
    const history = observations.find((row) => row.kind === "history");
    expect(history?.value).toContain("1842");
    expect(history?.sourceUrl).toBe("https://thetestarms.example/");
  });

  it("drops a hit with no https URL and never invents a price or a fact from the pub name", () => {
    expect(classifyExaHit({ title: "The Test Arms" })).toBeNull();
    const observations = observationsFromExaResults(
      pub,
      [{ title: "Guess: pints are £4.20 at The Test Arms" }],
      fetchedAt,
    );
    expect(observations).toEqual([]);
  });

  it("classifies a first-party host as website, a social host as social, a menu path as menu", () => {
    expect(classifyExaHit({ url: "https://thetestarms.example/" })?.kind).toBe("website");
    expect(classifyExaHit({ url: "https://x.com/thetestarms" })?.kind).toBe("social");
    expect(classifyExaHit({ url: "https://thetestarms.example/food-menu" })?.kind).toBe("menu");
  });
});

describe("Exa client", () => {
  it("returns no live client without a key, so a caller cannot fetch by accident", () => {
    const fetchImpl = vi.fn();
    expect(createExaClient({ env: {} as never, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads and trims EXA_API_KEY", () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const client = createExaClient({
      env: { EXA_API_KEY: "  exa-test  " } as never,
      fetchImpl,
      sleep: async () => {},
    });
    expect(client).not.toBeNull();
  });

  it("uses mock mode without a network call", async () => {
    const fetchImpl = vi.fn();
    const client = createExaClient({ env: {} as never, fetchImpl, mock: true });
    expect(client).not.toBeNull();
    const payload = await client!.search("The Test Arms London pub official website");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(Array.isArray(payload.results)).toBe(true);
    expect(EXA_SEARCH_URL).toBe("https://api.exa.ai/search");
    expect(EXA_CONTENTS_URL).toBe("https://api.exa.ai/contents");
  });

  it("backs off on 429 and retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const slept: number[] = [];
    const client = createExaClient({
      env: { EXA_API_KEY: "exa-test" } as never,
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    const payload = await client!.search("The Test Arms");
    expect(payload.results).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(slept[0]).toBeGreaterThan(0);
  });

  it("computes exponential backoff with a Retry-After override", () => {
    expect(backoffMs(0, null)).toBe(4_000);
    expect(backoffMs(1, null)).toBe(8_000);
    expect(backoffMs(0, "12")).toBe(12_000);
  });

  it("POSTs /search with nested highlights, outputSchema and systemPrompt, and omits maxAgeHours for lore", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ results: [], output: { content: {}, grounding: [] } }), { status: 200 }),
    );
    const client = createExaClient({
      env: { EXA_API_KEY: "exa-test" } as never,
      fetchImpl,
      sleep: async () => {},
    });
    await client!.search("The Test Arms UK pub official website history", { purpose: "lore" });
    const firstCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit?];
    expect(firstCall[0]).toBe(EXA_SEARCH_URL);
    const body = JSON.parse(String(firstCall[1]?.body));
    expect(body.type).toBe("auto");
    expect(body.contents).toEqual({ highlights: true });
    expect(body.contents.maxAgeHours).toBeUndefined();
    expect(body.highlights).toBeUndefined();
    expect(body.outputSchema).toEqual(EXA_PUB_OUTPUT_SCHEMA);
    expect(body.systemPrompt).toBe(EXA_SYSTEM_PROMPT);
    expect(body.systemPrompt.toLowerCase()).toContain("official");
    for (const key of EXA_DEPRECATED_PARAM_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(body, key)).toBe(false);
      expect(JSON.stringify(body.contents)).not.toContain(key);
    }
  });

  it("aborts a hung Exa request and retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const client = createExaClient({
      env: { EXA_API_KEY: "exa-test" } as never,
      fetchImpl,
      sleep: async () => {},
      requestTimeoutMs: 20,
    });
    const payload = await client!.search("The Test Arms");
    expect(payload.results).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("POSTs /contents with top-level highlights for a known OSM website", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const client = createExaClient({
      env: { EXA_API_KEY: "exa-test" } as never,
      fetchImpl,
      sleep: async () => {},
    });
    await client!.contents(["https://thetestarms.example/"], { purpose: "lore" });
    const firstCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit?];
    expect(firstCall[0]).toBe(EXA_CONTENTS_URL);
    expect(JSON.parse(String(firstCall[1]?.body))).toEqual({
      urls: ["https://thetestarms.example/"],
      highlights: true,
    });
  });
});

describe("Exa request builders (captain 2026-08-25 guide)", () => {
  it("nests highlights under contents and omits maxAgeHours for lore", () => {
    const body = buildExaSearchBody({ query: "The Test Arms UK pub", purpose: "lore" });
    expect(body.contents).toEqual({ highlights: true });
    expect(body.outputSchema).toEqual(EXA_PUB_OUTPUT_SCHEMA);
    expect(body.systemPrompt).toBe(EXA_SYSTEM_PROMPT);
    expect(body.type).toBe("auto");
  });

  it("sets contents.maxAgeHours to 24 for menu and price searches", () => {
    const body = buildExaSearchBody({ query: "The Test Arms drinks menu", purpose: "menu" });
    expect(body.contents.highlights).toBe(true);
    expect(body.contents.maxAgeHours).toBe(24);
  });

  it("does not put citation fields in the output schema", () => {
    const blob = JSON.stringify(EXA_PUB_OUTPUT_SCHEMA).toLowerCase();
    expect(blob).not.toMatch(/citation/);
    expect(blob).not.toMatch(/sourceurl/);
    expect(Object.keys(EXA_PUB_OUTPUT_SCHEMA.properties ?? {})).toHaveLength(5);
    expect(Object.keys(EXA_PUB_OUTPUT_SCHEMA.properties ?? {}).length).toBeLessThanOrEqual(10);
  });

  it("puts highlights at the top level on /contents and uses urls we already have", () => {
    const body = buildExaContentsBody({ urls: ["https://thetestarms.example/"], purpose: "lore" });
    expect(body).toEqual({ urls: ["https://thetestarms.example/"], highlights: true });
  });

  it("sets top-level maxAgeHours 24 on /contents for menu and price pages", () => {
    const body = buildExaContentsBody({
      urls: ["https://thetestarms.example/menu"],
      purpose: "menu",
    });
    expect(body.highlights).toBe(true);
    expect(body.maxAgeHours).toBe(24);
    expect("contents" in body ? body.contents : undefined).toBeUndefined();
  });
});

describe("grounded structured output", () => {
  const fetchedAt = "2026-08-25T12:00:00.000Z";

  it("stores content fields only when grounding supplies an https citation", () => {
    const observations = observationsFromExaOutput(
      {
        officialWebsite: "https://thetestarms.example/",
        history: "Poured cask ale since 1842.",
        socialHandles: ["https://www.instagram.com/thetestarms"],
        menuOrPricePages: [],
        notableCoverage: [],
      },
      [
        {
          field: "officialWebsite",
          citations: [{ url: "https://thetestarms.example/", title: "Home" }],
          confidence: "high",
        },
        {
          field: "history",
          citations: [{ url: "https://thetestarms.example/about", title: "About" }],
          confidence: "high",
        },
        {
          field: "socialHandles[0]",
          citations: [{ url: "https://www.instagram.com/thetestarms", title: "Instagram" }],
          confidence: "high",
        },
      ],
      fetchedAt,
    );
    expect(observations.every((row) => row.sourceUrl.startsWith("https://") && row.fetchedAt === fetchedAt)).toBe(
      true,
    );
    expect(observations.find((row) => row.kind === "website")?.sourceUrl).toBe("https://thetestarms.example/");
    expect(observations.find((row) => row.kind === "history")?.value).toContain("1842");
    expect(observations.find((row) => row.kind === "social")?.sourceUrl).toBe(
      "https://www.instagram.com/thetestarms",
    );
  });

  it("keeps two array facts that share one citation URL", () => {
    const observations = observationsFromExaOutput(
      {
        socialHandles: ["https://www.instagram.com/a", "https://www.facebook.com/a"],
      },
      [
        {
          field: "socialHandles",
          citations: [{ url: "https://thetestarms.example/contact", title: "Contact" }],
          confidence: "high",
        },
      ],
      fetchedAt,
    );
    expect(observations.filter((row) => row.kind === "social")).toHaveLength(2);
  });

  it("does not fetch a menu URL with no grounding citation", () => {
    expect(
      groundedMenuUrls({
        content: { menuOrPricePages: ["https://thetestarms.example/menu"] },
        grounding: [],
      }),
    ).toEqual([]);
    expect(
      groundedMenuUrls({
        content: { menuOrPricePages: ["https://thetestarms.example/menu"] },
        grounding: [
          {
            field: "menuOrPricePages[0]",
            citations: [{ url: "https://thetestarms.example/", title: "Home" }],
            confidence: "high",
          },
        ],
      }),
    ).toEqual(["https://thetestarms.example/menu"]);
  });

  it("drops a synthesized field with no citation", () => {
    expect(
      observationsFromExaOutput(
        { history: "Founded in 1066." },
        [{ field: "history", citations: [], confidence: "low" }],
        fetchedAt,
      ),
    ).toEqual([]);
  });

  it("keeps output.content and output.grounding on the enriched record", () => {
    const pub = {
      osmId: "node/42",
      name: "The Test Arms",
      amenity: "pub",
      lat: 51.5,
      lng: -0.1,
      addressTags: {},
      website: null,
      socialTags: {},
      license: ODBL_LICENSE,
      attribution: ODBL_ATTRIBUTION,
      sourceUrl: "https://www.openstreetmap.org/node/42",
      fetchedAt,
    };
    const output = {
      content: { history: "Poured ale since 1842." },
      grounding: [
        {
          field: "history",
          citations: [{ url: "https://thetestarms.example/about", title: "About" }],
          confidence: "high",
        },
      ],
    };
    const record = enrichPub(pub, { results: [], output }, fetchedAt);
    expect(record.output).toEqual(output);
    expect(record.observations.some((row) => row.kind === "history")).toBe(true);
  });

  it("reads an OSM-stated https website for a cheaper /contents call", () => {
    expect(
      officialWebsiteUrl({
        website: {
          value: "https://thetestarms.example/",
          sourceUrl: "https://www.openstreetmap.org/node/42",
          fetchedAt,
        },
      }),
    ).toBe("https://thetestarms.example/");
    expect(officialWebsiteUrl({ website: { value: "http://insecure.example/", sourceUrl: "x", fetchedAt } })).toBe(
      null,
    );
    expect(officialWebsiteUrl({ website: null })).toBe(null);
  });
});

describe("checkpointed shards", () => {
  it("writes JSONL atomically and resumes after the last complete shard", async () => {
    const dir = await tmp();
    const rows = Array.from({ length: SHARD_SIZE + 3 }, (_, i) => ({ osmId: `node/${i}`, name: `Pub ${i}` }));
    await writeShardAtomic(dir, 0, rows.slice(0, SHARD_SIZE));
    expect(nextShardIndex(dir)).toBe(1);
    await writeShardAtomic(dir, 1, rows.slice(SHARD_SIZE));
    expect(nextShardIndex(dir)).toBe(2);
    expect(shardFileName(0)).toBe("shard_0000.jsonl");
    const first = await readJsonl(path.join(dir, shardFileName(0)));
    expect(first).toHaveLength(SHARD_SIZE);
    expect(first[0]).toEqual({ osmId: "node/0", name: "Pub 0" });
    const names = await readdir(dir);
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("resumes from the persisted row count, including a short tail shard", async () => {
    const dir = await tmp();
    await writeShardAtomic(dir, 0, Array.from({ length: SHARD_SIZE }, (_, i) => ({ osmId: `node/${i}` })));
    await writeShardAtomic(dir, 1, [{ osmId: "node/tail-0" }, { osmId: "node/tail-1" }]);
    expect(nextShardIndex(dir)).toBe(2);
    expect(await persistedShardRowCount(dir)).toBe(SHARD_SIZE + 2);
  });

  it("does not treat a leftover tmp file as a complete shard", async () => {
    const dir = await tmp();
    await writeJsonlAtomic(path.join(dir, ".shard_0000.jsonl.tmp"), [{ osmId: "node/1" }]);
    expect(nextShardIndex(dir)).toBe(0);
  });
});

describe("progress file", () => {
  it("records counts and an ETA from remaining work and observed rate", async () => {
    const dir = await tmp();
    const progress = {
      stage: "enrich" as const,
      seedCount: 40_000,
      enrichedCount: 1_000,
      completeShards: 2,
      lastCompleteShard: 1,
      startedAt: "2026-08-25T12:00:00.000Z",
      updatedAt: "2026-08-25T12:10:00.000Z",
      mock: true,
      attribution: ODBL_ATTRIBUTION,
    };
    await writeProgress(dir, progress);
    const loaded = await loadProgress(dir);
    expect(loaded?.seedCount).toBe(40_000);
    expect(loaded?.completeShards).toBe(2);
    const eta = estimateEta({
      remaining: 39_000,
      elapsedMs: 10 * 60 * 1000,
      done: 1_000,
    });
    expect(eta.etaIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(eta.ratePerHour).toBe(6_000);
  });
});

describe("mock Exa fixture", () => {
  it("returns sourced hits for a named pub and empty results otherwise", () => {
    const hits = mockExaPayload({ name: "The Turks Head" });
    expect(hits.results.length).toBeGreaterThan(0);
    expect(hits.results.every((hit) => typeof hit.url === "string" && hit.url.startsWith("https://"))).toBe(true);
    expect(mockExaPayload({ name: "Unlisted Vault" }).results).toEqual([]);
  });

  it("matches the named fixture inside a harvest search query", () => {
    const query = harvestSearchQuery({
      name: "The Turks Head",
      addressTags: { "addr:city": "St Agnes" },
    } as never);
    expect(query).toContain("The Turks Head");
    expect(mockExaPayload({ name: query }).results.length).toBeGreaterThan(0);
  });
});

describe("fatal Exa errors", () => {
  const fetchedAt = "2026-08-27T00:00:00.000Z";
  const pub = {
    osmId: "node/42",
    name: "The Test Arms",
    amenity: "pub",
    lat: 51.5,
    lng: -0.1,
    addressTags: {},
    website: {
      value: "https://thetestarms.example/",
      sourceUrl: "https://www.openstreetmap.org/node/42",
      fetchedAt,
    },
    socialTags: {},
    license: ODBL_LICENSE,
    attribution: ODBL_ATTRIBUTION,
    sourceUrl: "https://www.openstreetmap.org/node/42",
    fetchedAt,
  };

  it("does not swallow an Exa credits refusal as an empty observation list", async () => {
    const search = vi.fn(async () => {
      throw new Error('Exa 402: {"tag":"NO_MORE_CREDITS"}');
    });
    const contents = vi.fn(async () => {
      throw new Error('Exa 402: {"tag":"NO_MORE_CREDITS"}');
    });
    await expect(
      enrichPubWithClient(pub, { mock: false, search, contents }, fetchedAt),
    ).rejects.toThrow(/NO_MORE_CREDITS|Exa 402/);
  });
});
