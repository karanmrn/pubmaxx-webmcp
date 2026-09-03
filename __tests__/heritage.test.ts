import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: () => {},
  assertProductionSecrets: () => {},
}));

import { POST } from "@/app/api/heritage/route";
import {
  answerHeritage,
  retrieveHeritage,
  storedFactSource,
  __resetHeritageCache,
  __heritageCacheSizeForTests,
  __HERITAGE_CACHE_MAX_FOR_TESTS,
} from "@/lib/heritage";
import { parseOverlayRow } from "@/lib/harvestFold";
import {
  __resetHarvestOverlayStore,
  harvestOverlayStore,
} from "@/lib/harvestOverlayStore";

// These tests run fully offline: no OPENROUTER key, no Supabase, no network.
// They pin two guarantees:
//  1. The no-key path only ever repeats the facts we retrieved, and says so
//     honestly when there are none.
//  2. The trust boundary: ALL facts come from server-side stores
//     (heritage_cache.json + Supabase, keyed by normalised name). The route no
//     longer accepts a client `context` object, so a forged one is ignored.
beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetHeritageCache();
  __resetHarvestOverlayStore();
});

// A malicious client trying to forge "sourced" pub history via a context object
// the API no longer accepts.
const FORGED_CONTEXT = {
  era: "Tudor 1520",
  heritageNote: "Secret Roman haunted crypt beneath the bar since AD 60.",
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/heritage", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

const SOURCED_SOURCES = new Set(["osm", "wikidata", "wikipedia", "seed"]);

describe("retrieveHeritage — trust boundary", () => {
  it("rejects unknown stored source labels instead of relabelling them", () => {
    expect(storedFactSource("webbing")).toBeNull();
    expect(storedFactSource("web ")).toBeNull();
    expect(storedFactSource("seed")).toBe("seed");
  });

  it("ignores a forged client context entirely (context is no longer accepted)", async () => {
    const facts = await retrieveHeritage({
      // "Nowhere Tavern" has no server facts, so with context ignored there are none.
      venueName: "Nowhere Tavern",
      // @ts-expect-error — context is no longer part of the input type; a client
      // that still sends it must be ignored.
      context: FORGED_CONTEXT,
    });
    // The forged claim never becomes a fact...
    expect(facts.some((f) => f.fact.includes("Roman haunted crypt"))).toBe(false);
    // ...and no fact is anything but a server-sourced source (there are none here).
    expect(facts).toHaveLength(0);
    for (const fact of facts) {
      expect(SOURCED_SOURCES.has(fact.source)).toBe(true);
    }
  });

  it("reads server cache facts back as sourced", async () => {
    const facts = await retrieveHeritage({ venueName: "Prospect of Whitby" });
    const sourced = facts.filter((f) => SOURCED_SOURCES.has(f.source));
    expect(sourced.length).toBeGreaterThanOrEqual(2);
    // The shipped seed/wikipedia cache facts are present and trusted.
    expect(sourced.some((f) => f.source === "seed")).toBe(true);
    expect(facts.some((f) => f.fact.includes("Grade II* listed"))).toBe(true);
  });

  it("does not combine caller name facts with an OSM-specific request", async () => {
    const facts = await retrieveHeritage({
      venueId: "node/123",
      venueName: "Prospect of Whitby",
    });

    expect(facts.some((fact) => fact.fact.includes("Grade II* listed"))).toBe(false);
    expect(facts.some((fact) => fact.fact.includes("1520"))).toBe(false);
  });

  it("uses the resolved venue name for legacy facts", async () => {
    const facts = await retrieveHeritage({
      venueId: "venue-16pnwmm",
      venueName: "Nowhere Tavern",
    });

    expect(facts.some((fact) => fact.fact.includes("1520"))).toBe(true);
  });

  it("attaches cited harvest lore by OSM venue id, never by pub name", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        website: "https://redlion.example/",
        matchedLore: {
          text: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
          citations: ["https://history.example/red-lion-clapham"],
        },
        sources: ["https://redlion.example/"],
      }),
    ]);
    const byId = await retrieveHeritage({
      venueId: "venue-uk-n123",
      venueName: "Nowhere Tavern",
    });
    expect(byId.some((f) => f.source === "web")).toBe(true);
    expect(byId.some((f) => f.sourceRef === "https://history.example/red-lion-clapham")).toBe(
      true,
    );

    const byName = await retrieveHeritage({ venueName: "The Red Lion" });
    expect(byName.some((f) => f.source === "web")).toBe(false);
  });

  it("resolves salted city venue ids before reading harvest lore", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "way/100646638",
        name: "Peveril of the Peak",
        town: "Manchester",
        matchedLore: {
          text: "Peveril of the Peak in Manchester has a long history.",
          citations: ["https://history.example/peveril"],
        },
        sources: ["https://history.example/peveril"],
      }),
    ]);
    const facts = await retrieveHeritage({
      venueId: "venue-mcr-1lwo5lo",
      venueName: "Peveril of the Peak",
    });
    expect(facts.some((fact) => fact.source === "web")).toBe(true);
  });

  it("reads lore from every OSM object owned by one curated venue", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/13235500301",
        name: "The Grenadier",
        town: "London",
        matchedLore: {
          text: "The Grenadier in London has a story about its first mapped object.",
          citations: ["https://history.example/grenadier-node"],
        },
        sources: ["https://history.example/grenadier-node"],
      }),
      parseOverlayRow({
        osmId: "way/556177108",
        name: "The Grenadier",
        town: "London",
        matchedLore: {
          text: "The Grenadier in London has a story about its second mapped object.",
          citations: ["https://history.example/grenadier-way"],
        },
        sources: ["https://history.example/grenadier-way"],
      }),
    ]);

    const facts = await retrieveHeritage({
      venueId: "venue-1ha28jc",
      venueName: "The Grenadier",
    });
    expect(facts.filter((fact) => fact.source === "web").map((fact) => fact.sourceRef)).toEqual([
      "https://history.example/grenadier-node",
      "https://history.example/grenadier-way",
    ]);
  });
});

describe("answerHeritage (no key — grounded only)", () => {
  it("ignores a forged client context — no contributor fact or citation appears", async () => {
    const res = await answerHeritage({
      venueName: "Nowhere Tavern",
      question: "How old is this pub?",
      // @ts-expect-error — context is no longer accepted by the API.
      context: FORGED_CONTEXT,
    });
    // With no server facts and context ignored, it falls back to the honest line.
    expect(res.answer).toContain("no fuller story on record");
    // The forged content is never echoed and there is no contributor citation.
    expect(res.answer).not.toContain("Roman");
    expect(res.citations).toHaveLength(0);
    expect(res.citations.some((c) => c.source === "contributor")).toBe(false);
  });

  it("cites server facts as sourced", async () => {
    const res = await answerHeritage({
      venueName: "Prospect of Whitby",
      question: "How old is this pub?",
    });
    expect(res.answer).toContain("1520");
    expect(res.answer).not.toContain("Roman");
    expect(res.citations.some((c) => SOURCED_SOURCES.has(c.source))).toBe(true);
  });

  it("says it has no fuller story when there are zero facts", async () => {
    const res = await answerHeritage({
      venueName: "Nowhere Tavern",
      question: "What's the story here?",
    });
    expect(res.answer).toContain("no fuller story on record");
    expect(res.citations).toHaveLength(0);
  });

  it("uses kind-honest clarification copy for a late-food venue", async () => {
    const res = await answerHeritage({
      venueName: "Nowhere Kitchen",
      venueKind: "food",
      question: "What's the story here?",
    });

    expect(res.clarifyingQuestion).toBe(
      "What would you like to know about this late-food venue?",
    );
  });
});

describe("POST /api/heritage", () => {
  it("rejects a missing venueName with 400", async () => {
    const res = await post({ question: "How old is this pub?" });
    expect(res.status).toBe(400);
  });

  it("returns a grounded 200 backed by server facts", async () => {
    const res = await post({
      venueName: "Prospect of Whitby",
      question: "How old is this pub?",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toContain("1520");
  });

  it("resolves venue name and kind server-side when an id is supplied", async () => {
    const res = await post({
      venueId: "food-best-turkish-kebab",
      venueName: "Prospect of Whitby",
      question: "What's the story here?",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).not.toContain("1520");
    expect(body.clarifyingQuestion).toBe(
      "What would you like to know about this late-food venue?",
    );
  });

  it("caps an oversized venueName so a hostile client can't blow up retrieval", async () => {
    // 5 kB of garbage. The route must accept the request (still a 200 — the
    // demo never 500s), and the truncated normalised name matches no server
    // facts, so we get the honest empty-line answer.
    const padded = "Some Pub " + "x".repeat(5_000);
    const res = await post({ venueName: padded, question: "How old is this pub?" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.answer).toBe("string");
    // No server facts match a mangled 5 kB name → honest empty-line fallback.
    expect(body.answer).toContain("no fuller story on record");
    // And there are no citations for a name that doesn't resolve.
    expect(body.citations).toHaveLength(0);
  });

  it("ignores a forged `context` in the request body", async () => {
    // A client that still POSTs `context` must not have it echoed as history.
    const res = await post({
      venueName: "Nowhere Tavern",
      question: "How old is this pub?",
      context: FORGED_CONTEXT,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toContain("no fuller story on record");
    expect(body.answer).not.toContain("Roman");
    expect(body.citations).toHaveLength(0);
  });
});

// P3.10 — The Landlord LLM bounds. OpenRouter is mocked via global.fetch:
// no network, no real key. Pins: temperature 0 + max-token cap + abort signal
// on the request; timeout → honest fallback; phantom fact-id citation →
// rejected (fallback); valid fact-id markers → stripped from the answer.
describe("The Landlord LLM bounds (mocked OpenRouter)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    __resetHeritageCache(); // don't let a cached answer mask a per-case mock
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function okResponse(content: string): Response {
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as unknown as Response;
  }

  it("sends temperature 0, a max-token cap, and an abort signal", async () => {
    const fetchMock = vi.fn(async () => okResponse("Built in 1520 [F1]."));
    global.fetch = fetchMock as unknown as typeof fetch;

    await answerHeritage({ venueName: "Prospect of Whitby", question: "How old?" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Facts are numbered so citations can be validated server-side.
    expect(body.messages[1].content).toContain("[F1]");
  });

  it("falls back to the honest answer on timeout", async () => {
    vi.useFakeTimers();
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => (fetchStarted = resolve));
    // A fetch that never resolves — it only rejects when the abort fires.
    global.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      fetchStarted();
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }) as unknown as typeof fetch;

    const pending = answerHeritage({
      venueName: "Nowhere Tavern",
      question: "What's the story here?",
    });
    await started; // retrieval (real I/O) done, the timeout timer is armed
    await vi.advanceTimersByTimeAsync(11_000); // past the 10s LLM timeout

    const res = await pending;
    expect(res.answer).toContain("no fuller story on record");
  });

  it("rejects an answer citing a phantom fact id and falls back", async () => {
    global.fetch = vi.fn(async () =>
      okResponse("Founded by Dick Turpin in 1520 [F42]."),
    ) as unknown as typeof fetch;

    const res = await answerHeritage({
      venueName: "Prospect of Whitby",
      question: "How old is this pub?",
    });
    // The fabricated line never reaches the client; the grounded read-back does.
    expect(res.answer).not.toContain("Dick Turpin");
    expect(res.answer).toContain("Here's what's on record");
  });

  it("strips valid fact-id markers from the answer", async () => {
    global.fetch = vi.fn(async () =>
      okResponse("Dating to 1520 [F1], it is a famous riverside pub."),
    ) as unknown as typeof fetch;

    const res = await answerHeritage({
      venueName: "Prospect of Whitby",
      question: "How old is this pub?",
    });
    expect(res.answer).toBe("Dating to 1520, it is a famous riverside pub.");
  });

  // P2 — 5-minute answer cache. Same venue+question serves the cached answer
  // without a second paid call; a different venue must NOT collide.
  it("serves a cached LLM answer for the same venue+question", async () => {
    const fetchMock = vi.fn(async () => okResponse("Built in 1520."));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await answerHeritage({ venueName: "Prospect of Whitby", question: "How old?" });
    const second = await answerHeritage({ venueName: "Prospect of Whitby", question: "How old?" });

    expect(second.answer).toBe(first.answer);
    expect(fetchMock).toHaveBeenCalledTimes(1); // second read hit the cache
  });

  it("bounds the answer cache to a fixed maximum (oldest entry evicted)", async () => {
    // Every LLM call returns a distinct short answer so cache keys don't collide
    // on the (venue, question) axis and the size test measures the bound.
    global.fetch = vi.fn(async () => okResponse("cached.")) as unknown as typeof fetch;

    // Fill just past the bound with unique venue names.
    const overshoot = 5;
    for (let i = 0; i < __HERITAGE_CACHE_MAX_FOR_TESTS + overshoot; i += 1) {
      await answerHeritage({
        venueName: `Bounded Pub ${i}`,
        question: "How old is this pub?",
      });
    }

    expect(__heritageCacheSizeForTests()).toBe(__HERITAGE_CACHE_MAX_FOR_TESTS);
  });

  it("never returns one venue's cached answer for another venue", async () => {
    global.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      const isWhitby = body.messages[1].content.includes("Grade II* listed");
      return okResponse(isWhitby ? "Whitby answer." : "Other answer.");
    }) as unknown as typeof fetch;

    const q = "Tell me about this pub?";
    const a = await answerHeritage({ venueName: "Prospect of Whitby", question: q });
    const b = await answerHeritage({ venueName: "Nowhere Tavern", question: q });

    expect(a.answer).toBe("Whitby answer.");
    expect(b.answer).not.toBe(a.answer); // distinct key → distinct answer
  });

  it("separates cached answers by canonical OSM venue identity", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        matchedLore: {
          text: "The Red Lion in Clapham has stood here for centuries.",
          citations: ["https://history.example/red-lion-a"],
        },
        sources: ["https://history.example/red-lion-a"],
      }),
      parseOverlayRow({
        osmId: "node/456",
        name: "The Red Lion",
        town: "Clapham",
        matchedLore: {
          text: "The Red Lion in Clapham was rebuilt after a fire.",
          citations: ["https://history.example/red-lion-b"],
        },
        sources: ["https://history.example/red-lion-b"],
      }),
    ]);
    const fetchMock = vi.fn(async () => okResponse("Distinct answer."));
    global.fetch = fetchMock as unknown as typeof fetch;

    await answerHeritage({
      venueId: "node/123",
      venueName: "The Red Lion",
      question: "What is its story?",
    });
    await answerHeritage({
      venueId: "node/456",
      venueName: "The Red Lion",
      question: "What is its story?",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// FIX 1 guard: retrieval (lib/heritage.ts), the writer (enrich_heritage.mjs),
// and the migration must all agree on the `venue_key` column. If any drifts
// back to `pub_id`/`venue_name`, this fails.
describe("schema key alignment (venue_key)", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8");
  // Migration files carry a remote-ledger timestamp prefix
  // (`<version>_NNNN_name.sql`) so the Supabase preview-branch check matches
  // them. Resolve by the stable `NNNN_name` suffix instead of a fixed prefix.
  const readMigration = (suffix: string) => {
    const dir = path.join(process.cwd(), "supabase/migrations");
    const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
    if (!file) throw new Error(`migration *_${suffix}.sql not found`);
    return readFileSync(path.join(dir, file), "utf8");
  };

  it("migration, writer, and retrieval all use venue_key", () => {
    const migration = readMigration("0002_pub_heritage");
    const writer = read("scripts/enrich_heritage.mjs");
    const retrieval = read("lib/heritage.ts");

    expect(migration).toMatch(/venue_key\s+text/);
    expect(migration).not.toMatch(/pub_id/);
    expect(writer).toMatch(/venue_key:/);
    expect(writer).not.toMatch(/venue_name:/);
    expect(retrieval).toContain('.eq("venue_key"');
    expect(retrieval).not.toContain("pub_id");
  });
});
