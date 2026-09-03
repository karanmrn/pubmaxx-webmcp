// scripts/check_freshness.mjs is the dependency-free CLI mirror of
// lib/freshness.ts's evaluateDataset/resolveStoreStamp — it must draw the SAME
// stale-vs-unmeasurable line without importing @supabase/supabase-js, using a
// raw PostgREST fetch instead. These tests exercise the store-kind path
// end-to-end through evaluateFreshness(), including the unreachable case,
// pinning that a store this mirror cannot query without credentials reports
// unmeasurable-without-credentials explicitly rather than guessing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateFreshness } from "@/scripts/check_freshness.mjs";

const NOW = new Date("2026-07-18T12:00:00Z");
const realFetch = global.fetch;
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function storeRegistry(feedKey = "price_update_retrieval") {
  return {
    version: 1,
    datasets: [
      {
        id: feedKey,
        label: "Test store feed",
        class: "cron",
        artifact: null,
        stamp: { kind: "store", feedKey },
        cadence: "daily",
        stalenessBudgetHours: null,
        refreshWorkflow: "Test cron",
        gate: "none",
      },
    ],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  global.fetch = realFetch;
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

describe("evaluateFreshness — store-kind dataset, dependency-free PostgREST mirror", () => {
  it("reports unmeasurable-without-credentials when Supabase env vars are absent, never a fetch call", async () => {
    global.fetch = vi.fn();

    const { results, breached } = await evaluateFreshness({ now: NOW, registry: storeRegistry() });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("unknown");
    expect(results[0].detail).toContain("unmeasurable without credentials");
    expect(breached).toBe(true);
  });

  it("reads ok and resolves the real observedAt via a raw PostgREST fetch", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain("/rest/v1/feed_freshness");
      expect(String(url)).toContain("feed=eq.price_update_retrieval");
      expect(init.headers.apikey).toBe("test-service-role-key");
      expect(init.headers.Authorization).toBe("Bearer test-service-role-key");
      return new Response(JSON.stringify([{ observed_at: "2026-07-16T00:00:00Z" }]), { status: 200 });
    });

    const { results, breached } = await evaluateFreshness({ now: NOW, registry: storeRegistry() });

    expect(results[0].observedAt).toBe("2026-07-16T00:00:00Z");
    // stalenessBudgetHours is intentionally null (episodic), so an ok read is
    // "untracked", never "fresh" — the budget question is a separate concern
    // from whether the age could be measured at all.
    expect(results[0].status).toBe("untracked");
    expect(breached).toBe(false);
  });

  it("reads the What's-On generation watermark from its durable listing store", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    global.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain("/rest/v1/whats_on_listing_generations");
      return new Response(JSON.stringify([{ generated_at: "2026-07-18T11:00:00Z" }]), { status: 200 });
    });

    const { results, breached } = await evaluateFreshness({
      now: NOW,
      registry: storeRegistry("whats_on"),
    });

    expect(results[0].observedAt).toBe("2026-07-18T11:00:00Z");
    expect(results[0].status).toBe("untracked");
    expect(breached).toBe(false);
  });

  it("distinguishes empty (no row yet) from unreachable and unconfigured", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    global.fetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));

    const { results, breached } = await evaluateFreshness({ now: NOW, registry: storeRegistry() });

    expect(results[0].status).toBe("unknown");
    expect(results[0].detail).toContain("holds no stamp yet");
    expect(results[0].detail).not.toContain("credentials");
    expect(breached).toBe(true);
  });

  it("the unreachable case: a network failure never reads as fresh or silently stale", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    global.fetch = vi.fn(async () => {
      throw new Error("fetch failed: getaddrinfo ENOTFOUND");
    });

    const { results, breached } = await evaluateFreshness({ now: NOW, registry: storeRegistry() });

    expect(results[0].status).toBe("unknown");
    expect(results[0].observedAt).toBeNull();
    expect(results[0].detail).toContain("could not be queried");
    expect(results[0].detail).toContain("ENOTFOUND");
    expect(breached).toBe(true);
  });

  it("the unreachable case: a non-ok HTTP response (e.g. missing table) is unreachable, not empty", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ message: "Could not find the table 'public.feed_freshness' in the schema cache" }),
          { status: 404 },
        ),
    );

    const { results, breached } = await evaluateFreshness({ now: NOW, registry: storeRegistry() });

    expect(results[0].status).toBe("unknown");
    expect(results[0].detail).toContain("could not be queried");
    expect(results[0].detail).toContain("migration 0047");
    expect(breached).toBe(true);
  });

  it("an unmeasurable store never counts as stale, even far past any implicit cadence", async () => {
    global.fetch = vi.fn();
    const { results } = await evaluateFreshness({ now: NOW, registry: storeRegistry() });
    expect(results[0].status).not.toBe("stale");
    expect(results[0].status).not.toBe("fresh");
  });
});

// The same mirror has to draw the OTHER line the app draws: a declared row pack
// is opened whatever dates it, and nothing else is. Drift here is how the CLI
// and the deployed audit come to disagree about the same file.
describe("evaluateFreshness — a declared row pack", () => {
  const roots: string[] = [];

  function packRegistry(extra: Record<string, unknown> = {}) {
    return {
      version: 1,
      datasets: [
        {
          id: "historic_pubs",
          label: "Historic pubs index",
          class: "episodic",
          artifact: "public/data/historic_pubs.json",
          pack: true,
          stamp: { kind: "literal", value: "2026-07-18T00:00:00Z" },
          cadence: "episodic",
          stalenessBudgetHours: 2160,
          refreshWorkflow: "Test build",
          gate: "none",
          ...extra,
        },
      ],
    };
  }

  function rootHolding(contents: string | null) {
    const root = mkdtempSync(join(tmpdir(), "check-freshness-pack-"));
    roots.push(root);
    if (contents !== null) {
      mkdirSync(join(root, "public/data"), { recursive: true });
      writeFileSync(join(root, "public/data/historic_pubs.json"), contents, "utf8");
    }
    return root;
  }

  afterEach(() => {
    while (roots.length > 0) {
      rmSync(roots.pop() as string, { recursive: true, force: true });
    }
  });

  it("reports an empty pack as unknown rather than answering its literal stamp", async () => {
    const { results, breached } = await evaluateFreshness({
      now: NOW,
      rootDir: rootHolding("[]"),
      registry: packRegistry(),
    });
    expect(results[0].status).toBe("unknown");
    expect(results[0].detail).toContain("empty (0 rows)");
    expect(breached).toBe(true);
  });

  it("reports a pack that is not on disk as unknown, never fresh", async () => {
    const { results } = await evaluateFreshness({
      now: NOW,
      rootDir: rootHolding(null),
      registry: packRegistry(),
    });
    expect(results[0].status).toBe("unknown");
    expect(results[0].detail).toContain("not present at runtime");
  });

  it("answers the literal stamp once the pack holds rows", async () => {
    const { results } = await evaluateFreshness({
      now: NOW,
      rootDir: rootHolding(JSON.stringify([{ slug: "the-lamb" }])),
      registry: packRegistry(),
    });
    expect(results[0].observedAt).toBe("2026-07-18T00:00:00Z");
    expect(results[0].status).toBe("fresh");
  });

  // Parity with lib/freshnessArtifact.ts resolveDatasetStamp: a pack naming no
  // artifact is unmeasurable in BOTH readers. They used to disagree here, and
  // the app was the one answering fresh.
  it("reports a pack that declares no artifact as unknown, matching the app reader", async () => {
    const { results, breached } = await evaluateFreshness({
      now: NOW,
      rootDir: rootHolding(null),
      registry: packRegistry({ artifact: null }),
    });
    expect(results[0].status).toBe("unknown");
    expect(results[0].detail).toContain("no artifact to read it from");
    expect(breached).toBe(true);
  });

  it("leaves a literal-stamped dataset that is NOT a pack unopened and fresh", async () => {
    const { results } = await evaluateFreshness({
      now: NOW,
      rootDir: rootHolding("[]"),
      registry: packRegistry({ pack: undefined }),
    });
    expect(results[0].observedAt).toBe("2026-07-18T00:00:00Z");
    expect(results[0].status).toBe("fresh");
  });
});
