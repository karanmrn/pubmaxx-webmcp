import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  evaluateDataset,
  evaluateRegistry,
  hasBreach,
  resolveObservedAt,
  resolveStamp,
  resolveStoreStamp,
  staleFeeds,
  unresolvedFeeds,
  type FreshnessDataset,
  type FreshnessRegistry,
  type StoreRead,
} from "@/lib/freshness";
import { readFreshnessArtifact, resolveDatasetStamp } from "@/lib/freshnessArtifact";
import { SIGHTING_MAX_AGE_HOURS } from "@/lib/feedSightings";

const NOW = new Date("2026-07-18T12:00:00Z");

function dataset(overrides: Partial<FreshnessDataset> = {}): FreshnessDataset {
  return {
    id: "sample",
    label: "Sample",
    class: "cron",
    artifact: "public/data/sample.json",
    stamp: { kind: "field", pointer: "generatedAt" },
    cadence: "daily",
    stalenessBudgetHours: 48,
    refreshWorkflow: "Sample refresh",
    gate: "none",
    ...overrides,
  };
}

describe("resolveObservedAt", () => {
  it("reads a top-level field stamp", () => {
    expect(
      resolveObservedAt({ kind: "field", pointer: "generatedAt" }, { generatedAt: "2026-07-16T00:00:00Z" }),
    ).toBe("2026-07-16T00:00:00Z");
  });

  it("returns a literal stamp verbatim", () => {
    expect(resolveObservedAt({ kind: "literal", value: "2026-07-03T12:00:00Z" }, undefined)).toBe(
      "2026-07-03T12:00:00Z",
    );
  });

  it("returns null for a null spec (static data)", () => {
    expect(resolveObservedAt(null, { generatedAt: "2026-07-16T00:00:00Z" })).toBeNull();
  });

  it("returns null when the field is missing, non-string, or unparseable", () => {
    expect(resolveObservedAt({ kind: "field", pointer: "generatedAt" }, {})).toBeNull();
    expect(resolveObservedAt({ kind: "field", pointer: "generatedAt" }, { generatedAt: 5 })).toBeNull();
    expect(
      resolveObservedAt({ kind: "field", pointer: "generatedAt" }, { generatedAt: "not-a-date" }),
    ).toBeNull();
  });

  it("returns null when the artifact is missing (undefined) for a field spec", () => {
    expect(resolveObservedAt({ kind: "field", pointer: "generatedAt" }, undefined)).toBeNull();
  });

  it("returns null for an unparseable literal", () => {
    expect(resolveObservedAt({ kind: "literal", value: "nope" }, undefined)).toBeNull();
  });
});

describe("resolveStamp — why a stamp could not be resolved", () => {
  const spec = { kind: "field", pointer: "generatedAt" } as const;

  it("resolves the field and attaches no reason", () => {
    expect(
      resolveStamp(spec, {
        kind: "ok",
        path: "public/data/sample.json",
        json: { generatedAt: "2026-07-16T00:00:00Z" },
      }),
    ).toEqual({ observedAt: "2026-07-16T00:00:00Z", reason: null });
  });

  it("names the artifact that is not there, rather than blaming the data", () => {
    const r = resolveStamp(spec, { kind: "missing", path: "public/data/sample.json" });
    expect(r.observedAt).toBeNull();
    expect(r.reason).toContain("public/data/sample.json");
    expect(r.reason).toContain("not present at runtime");
  });

  it("distinguishes an unparseable file from a missing one", () => {
    const r = resolveStamp(spec, {
      kind: "unreadable",
      path: "public/data/sample.json",
      error: "Unexpected token }",
    });
    expect(r.reason).toContain("could not be parsed");
    expect(r.reason).toContain("Unexpected token }");
  });

  it("distinguishes a present file missing the stamp field", () => {
    const r = resolveStamp(spec, { kind: "ok", path: "public/data/sample.json", json: {} });
    expect(r.reason).toContain("no parseable \"generatedAt\" field");
  });

  it("gives every failure mode a DIFFERENT sentence, so an alert is actionable", () => {
    const reasons = [
      resolveStamp(spec, { kind: "missing", path: "a.json" }).reason,
      resolveStamp(spec, { kind: "unreadable", path: "a.json", error: "boom" }).reason,
      resolveStamp(spec, { kind: "ok", path: "a.json", json: {} }).reason,
      resolveStamp(spec, { kind: "absent" }).reason,
      resolveStamp({ kind: "literal", value: "nope" }, { kind: "absent" }).reason,
    ];
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("reports no reason for a dataset that never promised a stamp", () => {
    expect(resolveStamp(null, { kind: "absent" })).toEqual({ observedAt: null, reason: null });
  });

  it("returns a literal stamp without touching the artifact", () => {
    expect(
      resolveStamp({ kind: "literal", value: "2026-07-03T12:00:00Z" }, { kind: "missing", path: "gone.json" }),
    ).toEqual({ observedAt: "2026-07-03T12:00:00Z", reason: null });
  });
});

describe("resolveStoreStamp — the durable-store four-way read, never fresh or stale when unmeasurable", () => {
  const spec = { kind: "store", feedKey: "price_update_retrieval" } as const;

  it("resolves an ok read and attaches no reason", () => {
    const read: StoreRead = { kind: "ok", observedAt: "2026-07-16T00:00:00Z" };
    expect(resolveStoreStamp(spec, read)).toEqual({ observedAt: "2026-07-16T00:00:00Z", reason: null });
  });

  it("reports unmeasurable-without-credentials for an unconfigured store, never a guess", () => {
    const read: StoreRead = { kind: "unconfigured" };
    const r = resolveStoreStamp(spec, read);
    expect(r.observedAt).toBeNull();
    expect(r.reason).toContain("price_update_retrieval");
    expect(r.reason).toContain("unmeasurable without credentials");
  });

  it("names the query failure for an unreachable store, distinct from unconfigured", () => {
    const read: StoreRead = { kind: "unreachable", error: "durable table missing (apply migration 0047): 404" };
    const r = resolveStoreStamp(spec, read);
    expect(r.observedAt).toBeNull();
    expect(r.reason).toContain("could not be queried");
    expect(r.reason).toContain("migration 0047");
  });

  it("distinguishes an empty store (no row yet) from unconfigured and unreachable", () => {
    const read: StoreRead = { kind: "empty" };
    const r = resolveStoreStamp(spec, read);
    expect(r.observedAt).toBeNull();
    expect(r.reason).toContain("holds no stamp yet");
    expect(r.reason).toContain("cron has not succeeded");
  });

  it("rejects an unparseable observedAt from an ok read rather than passing it through", () => {
    const read: StoreRead = { kind: "ok", observedAt: "not-a-date" };
    const r = resolveStoreStamp(spec, read);
    expect(r.observedAt).toBeNull();
    expect(r.reason).toContain("unparseable observedAt");
  });

  it("gives every failure mode a DIFFERENT sentence, so an alert is actionable", () => {
    const reasons = [
      resolveStoreStamp(spec, { kind: "unconfigured" }).reason,
      resolveStoreStamp(spec, { kind: "unreachable", error: "boom" }).reason,
      resolveStoreStamp(spec, { kind: "empty" }).reason,
      resolveStoreStamp(spec, { kind: "ok", observedAt: "nope" }).reason,
    ];
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("never merges unreachable/unconfigured/empty into fresh or stale: observedAt is always null", () => {
    const unmeasurable: StoreRead[] = [
      { kind: "unconfigured" },
      { kind: "unreachable", error: "network down" },
      { kind: "empty" },
    ];
    for (const read of unmeasurable) {
      expect(resolveStoreStamp(spec, read).observedAt).toBeNull();
    }
  });

  it("no-ops for a non-store spec (nothing was promised)", () => {
    expect(resolveStoreStamp(null, { kind: "empty" })).toEqual({ observedAt: null, reason: null });
    expect(
      resolveStoreStamp({ kind: "literal", value: "2026-07-03T12:00:00Z" }, { kind: "empty" }),
    ).toEqual({ observedAt: null, reason: null });
  });
});

describe("evaluateDataset — a store-kind dataset reads unknown, never fresh, when unmeasurable", () => {
  const storeDataset: FreshnessDataset = dataset({
    id: "price_update_retrieval",
    artifact: null,
    stamp: { kind: "store", feedKey: "price_update_retrieval" },
    stalenessBudgetHours: null,
  });

  it("reads unknown when the store is unmeasurable, not stale and not fresh", () => {
    const r = evaluateDataset(storeDataset, null, NOW, 'Durable store for "price_update_retrieval" is unmeasurable without credentials in this runtime.');
    expect(r.status).toBe("unknown");
    expect(r.detail).toContain("unmeasurable without credentials");
  });

  it("reads untracked (not stale) once the store answers, because the budget is intentionally unset", () => {
    const r = evaluateDataset(storeDataset, "2026-07-16T00:00:00Z", NOW, null);
    expect(r.status).toBe("untracked");
  });
});

describe("readFreshnessArtifact + resolveStamp — real files on disk", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "freshness-artifact-"));
    writeFileSync(join(dir, "resolves.json"), JSON.stringify({ generatedAt: "2026-07-17T09:00:00Z" }));
    writeFileSync(join(dir, "no-stamp.json"), JSON.stringify({ rows: [] }));
    writeFileSync(join(dir, "broken.json"), "{ not json");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const spec = { kind: "field", pointer: "generatedAt" } as const;

  it("computes a genuine age for an artifact whose timestamp resolves", () => {
    const { observedAt, reason } = resolveStamp(spec, readFreshnessArtifact(dir, "resolves.json"));
    expect(reason).toBeNull();
    const r = evaluateDataset(dataset(), observedAt, NOW, reason);
    expect(r.status).toBe("fresh");
    expect(r.ageHours).toBe(27);
  });

  it("reports unknown, never fresh, for an artifact that is not on disk", () => {
    const { observedAt, reason } = resolveStamp(spec, readFreshnessArtifact(dir, "absent.json"));
    const r = evaluateDataset(dataset(), observedAt, NOW, reason);
    expect(r.status).toBe("unknown");
    expect(r.ageHours).toBeNull();
    expect(r.detail).toContain("absent.json");
  });

  it("reports unknown for a file that is present but carries no stamp", () => {
    const { observedAt, reason } = resolveStamp(spec, readFreshnessArtifact(dir, "no-stamp.json"));
    const r = evaluateDataset(dataset(), observedAt, NOW, reason);
    expect(r.status).toBe("unknown");
    expect(r.detail).toContain("no-stamp.json");
  });

  it("reports unknown, with the parse error, for a corrupt file", () => {
    const read = readFreshnessArtifact(dir, "broken.json");
    expect(read.kind).toBe("unreadable");
    const r = evaluateDataset(dataset(), null, NOW, resolveStamp(spec, read).reason);
    expect(r.status).toBe("unknown");
    expect(r.detail).toContain("could not be parsed");
  });
});

describe("resolveDatasetStamp — a route opens only what it will read", () => {
  function countingRead() {
    const opened: (string | null)[] = [];
    const read = (_root: string, relPath: string | null) => {
      opened.push(relPath);
      return relPath === null
        ? ({ kind: "absent" } as const)
        : ({ kind: "missing", path: relPath } as const);
    };
    return { opened, read };
  }

  it("opens the artifact for a field stamp", () => {
    const { opened, read } = countingRead();
    const { observedAt, reason } = resolveDatasetStamp("/root", dataset(), read);
    expect(opened).toEqual(["public/data/sample.json"]);
    expect(observedAt).toBeNull();
    expect(reason).toContain("public/data/sample.json");
  });

  it("never opens the artifact of a literal-stamped dataset", () => {
    const { opened, read } = countingRead();
    const resolution = resolveDatasetStamp(
      "/root",
      dataset({ stamp: { kind: "literal", value: "2026-07-03T12:00:00Z" }, artifact: "public/data/huge.json" }),
      read,
    );
    expect(opened).toEqual([]);
    expect(resolution).toEqual({ observedAt: "2026-07-03T12:00:00Z", reason: null });
  });

  it("never opens the artifact of an unstamped dataset", () => {
    const { opened, read } = countingRead();
    const resolution = resolveDatasetStamp(
      "/root",
      dataset({ stamp: null, artifact: "public/data/reference.json" }),
      read,
    );
    expect(opened).toEqual([]);
    expect(resolution).toEqual({ observedAt: null, reason: null });
  });

  it("still reports a field stamp with no artifact as unresolvable, opening nothing", () => {
    const { opened, read } = countingRead();
    const { observedAt, reason } = resolveDatasetStamp("/root", dataset({ artifact: null }), read);
    expect(opened).toEqual([]);
    expect(observedAt).toBeNull();
    expect(reason).toContain("no artifact to read it from");
  });
});

// A row pack is the ONE dataset a reader opens without a field stamp, because
// its rows are the finding. The `pack: true` opt-in is what makes that read
// happen, and lib/freshnessTracing.mjs is what makes the file reach the
// function; a pack read is never widened to the rest of the registry.
describe("a declared row pack", () => {
  function countingRead() {
    const opened: (string | null)[] = [];
    const read = (_root: string, relPath: string | null) => {
      opened.push(relPath);
      return relPath === null
        ? ({ kind: "absent" } as const)
        : ({ kind: "missing", path: relPath } as const);
    };
    return { opened, read };
  }

  const historicPack = {
    id: "historic_pubs",
    label: "Historic pubs index",
    class: "episodic" as const,
    artifact: "public/data/historic_pubs.json",
    pack: true,
    stamp: { kind: "literal" as const, value: "2026-07-18T00:00:00Z" },
    stalenessBudgetHours: 2160,
  };

  it("is opened even though a literal stamp dates it", () => {
    const { opened, read } = countingRead();
    resolveDatasetStamp("/root", dataset(historicPack), read);
    expect(opened).toEqual(["public/data/historic_pubs.json"]);
  });

  it("answers its literal stamp when the pack holds rows", () => {
    const read = (_root: string, relPath: string | null) =>
      ({ kind: "ok", path: relPath ?? "", json: [{ slug: "a" }] }) as const;
    expect(resolveDatasetStamp("/root", dataset(historicPack), read)).toEqual({
      observedAt: "2026-07-18T00:00:00Z",
      reason: null,
    });
  });

  it.each([
    ["empty", [] as unknown, "empty (0 rows)"],
    ["not an array", {} as unknown, "does not hold a row array"],
  ])("refuses the stamp when the pack is %s", (_label, json, expected) => {
    const read = (_root: string, relPath: string | null) =>
      ({ kind: "ok", path: relPath ?? "", json }) as const;
    const resolution = resolveDatasetStamp("/root", dataset(historicPack), read);
    expect(resolution.observedAt).toBeNull();
    expect(resolution.reason).toContain(expected);
  });

  // A pack that names no artifact is a registry mistake, and the two readers
  // used to answer it differently: the app short-circuited on the missing path
  // and reported the literal stamp FRESH forever while the CLI gate failed the
  // build. They now agree, and they agree on the safe answer.
  it("refuses the stamp for a pack that declares no artifact at all", () => {
    const { opened, read } = countingRead();
    const resolution = resolveDatasetStamp(
      "/root",
      dataset({ ...historicPack, artifact: null }),
      read,
    );
    expect(opened).toEqual([]);
    expect(resolution.observedAt).toBeNull();
    expect(resolution.reason).toContain("no artifact to read it from");
  });

  it("evaluateRegistry reports an artifact-less pack as unknown, never fresh", () => {
    const registry: FreshnessRegistry = {
      version: 1,
      datasets: [dataset({ ...historicPack, artifact: null })],
    };
    const results = evaluateRegistry(
      registry,
      (d) => resolveDatasetStamp("/root", d, readFreshnessArtifact),
      NOW,
    );
    expect(results[0]?.status).toBe("unknown");
    expect(hasBreach(results)).toBe(true);
  });

  it("refuses the stamp when the pack never reached the deployed function", () => {
    const { read } = countingRead();
    const resolution = resolveDatasetStamp("/root", dataset(historicPack), read);
    expect(resolution.observedAt).toBeNull();
    expect(resolution.reason).toContain("not present at runtime");
  });

  it("evaluateRegistry reports an empty committed pack as unknown, never fresh", () => {
    const root = mkdtempSync(join(tmpdir(), "freshness-empty-historic-"));
    const artifactDir = join(root, "public/data");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "historic_pubs.json"), "[]\n", "utf8");
    const registry: FreshnessRegistry = { version: 1, datasets: [dataset(historicPack)] };
    const results = evaluateRegistry(
      registry,
      (d) => resolveDatasetStamp(root, d, readFreshnessArtifact),
      NOW,
    );
    const historic = results.find((r) => r.id === "historic_pubs");
    expect(historic?.status).toBe("unknown");
    expect(historic?.detail).toContain("empty (0 rows)");
    rmSync(root, { recursive: true, force: true });
  });

  it("evaluateRegistry reports a populated committed pack on its own stamp", () => {
    const root = mkdtempSync(join(tmpdir(), "freshness-full-historic-"));
    const artifactDir = join(root, "public/data");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, "historic_pubs.json"),
      JSON.stringify([{ slug: "the-lamb" }]),
      "utf8",
    );
    const registry: FreshnessRegistry = { version: 1, datasets: [dataset(historicPack)] };
    const results = evaluateRegistry(
      registry,
      (d) => resolveDatasetStamp(root, d, readFreshnessArtifact),
      NOW,
    );
    const historic = results.find((r) => r.id === "historic_pubs");
    expect(historic?.observedAt).toBe("2026-07-18T00:00:00Z");
    expect(historic?.status).not.toBe("unknown");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("staleFeeds / unresolvedFeeds — two findings, never merged", () => {
  const results = [
    evaluateDataset(dataset({ id: "old" }), "2026-07-01T12:00:00Z", NOW),
    evaluateDataset(dataset({ id: "blind" }), null, NOW, "Artifact gone.json is not present at runtime."),
    evaluateDataset(dataset({ id: "good" }), "2026-07-18T00:00:00Z", NOW),
  ];

  it("keeps a stale feed out of the unresolved list and vice versa", () => {
    expect(staleFeeds(results).map((r) => r.id)).toEqual(["old"]);
    expect(unresolvedFeeds(results).map((r) => r.id)).toEqual(["blind"]);
  });

  it("never counts an unresolved feed as fresh", () => {
    const blind = results.find((r) => r.id === "blind");
    expect(blind?.status).toBe("unknown");
    expect(blind?.status).not.toBe("fresh");
    expect(hasBreach(results)).toBe(true);
  });
});

describe("evaluateDataset — status + budget math", () => {
  it("marks a within-budget artifact fresh", () => {
    // 24h old, 48h budget.
    const r = evaluateDataset(dataset(), "2026-07-17T12:00:00Z", NOW);
    expect(r.status).toBe("fresh");
    expect(r.ageHours).toBe(24);
  });

  it("marks an over-budget artifact stale", () => {
    // 72h old, 48h budget.
    const r = evaluateDataset(dataset(), "2026-07-15T12:00:00Z", NOW);
    expect(r.status).toBe("stale");
    expect(r.ageHours).toBe(72);
  });

  it("treats exactly-at-budget as fresh (breach is strictly over)", () => {
    // 48h old, 48h budget — boundary is inclusive.
    const r = evaluateDataset(dataset(), "2026-07-16T12:00:00Z", NOW);
    expect(r.ageHours).toBe(48);
    expect(r.status).toBe("fresh");
  });

  it("flips to stale just past the budget", () => {
    // 48.1h old.
    const r = evaluateDataset(dataset(), "2026-07-16T11:54:00Z", NOW);
    expect(r.status).toBe("stale");
  });

  it("reports live datasets without ageing them", () => {
    const r = evaluateDataset(dataset({ class: "live", artifact: null, stamp: null }), null, NOW);
    expect(r.status).toBe("live");
    expect(r.ageHours).toBeNull();
  });

  it("reports a stamped-but-unresolved artifact as unknown", () => {
    const r = evaluateDataset(dataset(), null, NOW);
    expect(r.status).toBe("unknown");
  });

  it("reports a null-budget, null-stamp static dataset as untracked", () => {
    const r = evaluateDataset(
      dataset({ class: "static", stamp: null, stalenessBudgetHours: null }),
      null,
      NOW,
    );
    expect(r.status).toBe("untracked");
    expect(r.ageHours).toBeNull();
  });

  it("shows age but stays untracked when a stamp exists with no budget", () => {
    const r = evaluateDataset(
      dataset({ class: "episodic", stalenessBudgetHours: null }),
      "2026-01-01T12:00:00Z",
      NOW,
    );
    expect(r.status).toBe("untracked");
    expect(r.ageHours).toBeGreaterThan(0);
  });
});

describe("evaluateRegistry + hasBreach", () => {
  const registry: FreshnessRegistry = {
    version: 1,
    datasets: [
      dataset({ id: "fresh-one" }),
      dataset({ id: "stale-one" }),
      dataset({ id: "live-one", class: "live", artifact: null, stamp: null }),
    ],
  };

  const stamps: Record<string, string | null> = {
    "fresh-one": "2026-07-18T00:00:00Z",
    "stale-one": "2026-07-10T00:00:00Z",
    "live-one": null,
  };

  it("evaluates every dataset via the injected stamp resolver", () => {
    const results = evaluateRegistry(
      registry,
      (d) => ({ observedAt: stamps[d.id] ?? null, reason: null }),
      NOW,
    );
    expect(results.map((r) => r.status)).toEqual(["fresh", "stale", "live"]);
  });

  it("detects a breach when any dataset is stale or unknown", () => {
    const results = evaluateRegistry(
      registry,
      (d) => ({ observedAt: stamps[d.id] ?? null, reason: null }),
      NOW,
    );
    expect(hasBreach(results)).toBe(true);
  });

  it("reports no breach when all datasets are fresh/live/untracked", () => {
    const results = evaluateRegistry(
      { version: 1, datasets: [dataset({ id: "fresh-one" })] },
      () => ({ observedAt: "2026-07-18T06:00:00Z", reason: null }),
      NOW,
    );
    expect(hasBreach(results)).toBe(false);
  });
});

describe("data/freshness_registry.json integrity", () => {
  const root = join(__dirname, "..");
  const registry = JSON.parse(
    readFileSync(join(root, "data", "freshness_registry.json"), "utf8"),
  ) as FreshnessRegistry;

  it("declares a versioned, non-empty dataset list with unique ids", () => {
    expect(registry.version).toBe(1);
    expect(registry.datasets.length).toBeGreaterThan(0);
    const ids = registry.datasets.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not classify manually published feeds as cron schedules", () => {
    const byId = new Map(registry.datasets.map((dataset) => [dataset.id, dataset]));

    expect(byId.get("pint_prices")?.class).toBe("episodic");
    expect(byId.get("night_signals")).toMatchObject({
      class: "episodic",
      stalenessBudgetHours: null,
    });
    expect(byId.get("price_updates")).toMatchObject({
      class: "episodic",
      stalenessBudgetHours: null,
    });
    expect(byId.get("drink_price_updates")).toMatchObject({
      class: "episodic",
      stalenessBudgetHours: 336,
    });
    expect(byId.get("drink_price_updates")?.stalenessBudgetHours).toBe(SIGHTING_MAX_AGE_HOURS);
    expect(byId.has("price_update_retrieval")).toBe(false);
    expect(byId.get("night_signal_candidates")?.class).toBe("cron");
  });

  it("keeps cron ingestion feeds separate from the artifacts they cannot publish", () => {
    const byId = new Map(registry.datasets.map((dataset) => [dataset.id, dataset]));

    // An ingestion feed a serverless cron stamps carries no committed artifact,
    // so a run can never be mistaken for a publish of the file readers get. Its
    // age instead comes from a store-kind stamp naming its own feed key, read
    // from the durable feed_freshness table (see resolveStoreStamp).
    for (const id of ["night_signal_candidates"]) {
      expect(byId.get(id)).toMatchObject({
        class: "cron",
        artifact: null,
        stamp: { kind: "store", feedKey: id },
        stalenessBudgetHours: null,
      });
    }

    expect(byId.get("price_updates")?.artifact).toBe(
      "public/data/price_updates/latest.json",
    );
    expect(byId.get("price_updates")?.stalenessBudgetHours).toBeNull();
  });

  it("gives every live TfL read its own alarm", () => {
    const byId = new Map(registry.datasets.map((dataset) => [dataset.id, dataset]));

    // Three separate TfL surfaces, three separate entries. They share one HTTP
    // client and one keyless upstream, which is exactly why merging them would
    // be tempting and wrong: each has its own endpoint, fan-out, timeout budget
    // and failure mode, so a healthy last-train or disruption read must never
    // stand in for a bus card that has gone dark. Each entry names ITS route.
    const routeByDataset = {
      tfl_last_train: "app/api/last-train",
      tfl_nearby_buses: "app/api/nearby-bus-departures",
      tfl_disruption: "app/api/tfl-disruption",
    } as const;

    for (const [id, route] of Object.entries(routeByDataset)) {
      const dataset = byId.get(id);
      expect(dataset).toMatchObject({ class: "live", artifact: null, stamp: null });
      expect(dataset?.refreshWorkflow).toContain(route);
      // No entry may claim another's route, which is what a quiet recombination
      // would look like in this file.
      for (const [otherId, otherRoute] of Object.entries(routeByDataset)) {
        if (otherId === id) continue;
        expect(dataset?.refreshWorkflow).not.toContain(otherRoute);
      }
    }
  });

  it("keeps every declared artifact path present on disk", () => {
    for (const d of registry.datasets) {
      if (!d.artifact) continue;
      const exists = readFileSync(join(root, d.artifact), "utf8");
      expect(typeof exists).toBe("string");
    }
  });

  it("uses only known classes and coherent budget/stamp shapes", () => {
    // "snapshot" = a point-in-time captured dataset re-extracted on demand
    // (area_news fresh-facts layer, Cycle 15 Lane A).
    const classes = new Set(["cron", "episodic", "user-cadence", "live", "static", "snapshot"]);
    for (const d of registry.datasets) {
      expect(classes.has(d.class)).toBe(true);
      if (d.stalenessBudgetHours !== null) {
        expect(d.stalenessBudgetHours).toBeGreaterThan(0);
      }
      // A budgeted dataset must have a way to observe its stamp.
      if (d.stalenessBudgetHours !== null) {
        expect(d.stamp).not.toBeNull();
        if (d.stamp?.kind === "store") {
          expect(d.artifact).toBeNull();
        } else {
          expect(d.artifact).not.toBeNull();
        }
      }
      // Live datasets carry no disk artifact to age.
      if (d.class === "live") {
        expect(d.artifact).toBeNull();
        expect(d.stalenessBudgetHours).toBeNull();
      }
    }
  });

  it("resolves a real observed stamp for every budgeted artifact-backed feed", () => {
    for (const d of registry.datasets) {
      if (d.stalenessBudgetHours === null || d.stamp?.kind === "store") continue;
      const raw = JSON.parse(readFileSync(join(root, d.artifact as string), "utf8"));
      expect(resolveObservedAt(d.stamp, raw)).not.toBeNull();
    }
  });
});
