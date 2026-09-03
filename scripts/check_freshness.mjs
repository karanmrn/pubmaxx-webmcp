// Freshness check — validates every registered artifact's observed/generated
// stamp against its declared staleness budget (data/freshness_registry.json).
//
// Two entry points:
//   • CLI (node scripts/check_freshness.mjs) — prints a table and exits NON-ZERO
//     on any breach (stale) or broken artifact (unknown). This is the owner /
//     ad-hoc gate — a cadence breach here is a real "the data went stale" signal.
//   • evaluateFreshness({ now, rootDir }) — imported by scripts/validate-data.mjs
//     to surface breaches as a WARN without ever failing the build. Cadence is
//     owner-visibility, not a build-break: a late daily cron must never block a
//     code merge, so validate-data only warns. The dedicated CLI is where a
//     non-zero exit lives.
//
// Plain Node ESM, dependency-free — it re-implements the same tiny resolve/
// evaluate rules as lib/freshness.ts (kept in lockstep), exactly the way
// validate-data mirrors the app's row rules into a scratch-copyable script.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(__dirname, "..");

function isParseableDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

// Mirror of lib/storeBackend.ts isMissingTableSchema: same PostgREST/Postgres
// schema-miss signals, checked against a raw response/error body here instead
// of a Supabase client error object.
function looksLikeMissingTableSchema(text, table) {
  return new RegExp(
    `Could not find the table 'public\\.(${table})'|relation "public\\.(${table})" does not exist|schema cache`,
    "i",
  ).test(text ?? "");
}

// Mirror of lib/freshnessStoreOverlay.ts readDurableFeedStamp, dependency-free:
// a raw PostgREST fetch against the feed_freshness table (migration 0047),
// gated on the same two env vars lib/supabase.ts requires. Never throws —
// every outcome is one of the four StoreRead kinds mirrored below.
async function readDurableFeedStamp(feedKey) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { kind: "unconfigured" };

  const isWhatsOn = feedKey === "whats_on";
  const table = isWhatsOn ? "whats_on_listing_generations" : "feed_freshness";
  const query = isWhatsOn
    ? "select=generated_at&order=generated_at.asc&limit=1"
    : `feed=eq.${encodeURIComponent(feedKey)}&select=observed_at&limit=1`;
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/${table}?${query}`;
  try {
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (looksLikeMissingTableSchema(body, table)) {
        return {
          kind: "unreachable",
          error: `durable table missing (apply migration ${isWhatsOn ? "0119" : "0047"}): ${response.status} ${body}`.trim(),
        };
      }
      return { kind: "unreachable", error: `${response.status} ${response.statusText}: ${body}`.trim() };
    }
    const rows = await response.json();
    const observedAt = Array.isArray(rows) && rows.length > 0
      ? rows[0]?.[isWhatsOn ? "generated_at" : "observed_at"]
      : undefined;
    if (!observedAt) return { kind: "empty" };
    return { kind: "ok", observedAt };
  } catch (err) {
    return { kind: "unreachable", error: err instanceof Error ? err.message : String(err) };
  }
}

// Mirror of lib/freshness.ts resolveStoreStamp.
function resolveStoreStamp(spec, read) {
  if (!spec || spec.kind !== "store") return { observedAt: null, reason: null };
  if (read.kind === "unconfigured") {
    return {
      observedAt: null,
      reason: `Durable store for "${spec.feedKey}" is unmeasurable without credentials in this runtime.`,
    };
  }
  if (read.kind === "unreachable") {
    return {
      observedAt: null,
      reason: `Durable store for "${spec.feedKey}" could not be queried: ${read.error}`,
    };
  }
  if (read.kind === "empty") {
    return {
      observedAt: null,
      reason: `Durable store holds no stamp yet for "${spec.feedKey}" (the writing cron has not succeeded).`,
    };
  }
  if (isParseableDate(read.observedAt)) return { observedAt: read.observedAt, reason: null };
  return {
    observedAt: null,
    reason: `Durable store for "${spec.feedKey}" carries an unparseable observedAt.`,
  };
}

// Mirror of lib/freshness.ts resolveStamp: resolves the stamp, and says why when
// it cannot. "The file is not there" and "the file has no generatedAt" are
// different defects, so they get different sentences here too.
function resolveStamp(spec, read) {
  if (spec === null || spec === undefined) return { observedAt: null, reason: null };
  if (spec.kind === "literal") {
    if (isParseableDate(spec.value)) return { observedAt: spec.value, reason: null };
    return {
      observedAt: null,
      reason: `The registry's literal stamp "${spec.value}" is not a parseable date.`,
    };
  }
  if (spec.kind !== "field") return { observedAt: null, reason: null };

  if (read.kind === "absent") {
    return {
      observedAt: null,
      reason: `The registry declares a "${spec.pointer}" stamp but no artifact to read it from.`,
    };
  }
  if (read.kind === "missing") {
    return {
      observedAt: null,
      reason: `Artifact ${read.path} is not present at runtime, so its age cannot be measured.`,
    };
  }
  if (read.kind === "unreadable") {
    return { observedAt: null, reason: `Artifact ${read.path} could not be parsed: ${read.error}` };
  }
  const value =
    typeof read.json === "object" && read.json !== null ? read.json[spec.pointer] : undefined;
  if (isParseableDate(value)) return { observedAt: value, reason: null };
  return {
    observedAt: null,
    reason: `Artifact ${read.path} carries no parseable "${spec.pointer}" field.`,
  };
}

// Mirror of lib/freshness.ts evaluateDataset.
function evaluateDataset(dataset, observedAt, now, unresolvedReason = null) {
  const base = {
    id: dataset.id,
    label: dataset.label,
    class: dataset.class,
    cadence: dataset.cadence,
    refreshWorkflow: dataset.refreshWorkflow,
    gate: dataset.gate,
    artifact: dataset.artifact ?? null,
    stalenessBudgetHours: dataset.stalenessBudgetHours ?? null,
    observedAt,
  };

  if (dataset.class === "live") {
    return { ...base, ageHours: null, status: "live", detail: "Served live per request." };
  }
  const packUnmeasurable = dataset.pack === true && unresolvedReason !== null;
  if ((dataset.stamp || packUnmeasurable) && observedAt === null) {
    return {
      ...base,
      ageHours: null,
      status: "unknown",
      detail: unresolvedReason ?? "Expected a timestamp but none could be resolved from the artifact.",
    };
  }
  if (observedAt === null) {
    return { ...base, ageHours: null, status: "untracked", detail: "No stamp declared (static reference data)." };
  }

  const ageHours = Math.round(((now.getTime() - Date.parse(observedAt)) / 3_600_000) * 10) / 10;

  if (base.stalenessBudgetHours === null) {
    return { ...base, ageHours, status: "untracked", detail: "Intentionally not budgeted (episodic / user-cadence)." };
  }
  const stale = ageHours > base.stalenessBudgetHours;
  return {
    ...base,
    ageHours,
    status: stale ? "stale" : "fresh",
    detail: stale
      ? `Aged ${ageHours}h, over the ${base.stalenessBudgetHours}h budget.`
      : `Aged ${ageHours}h, within the ${base.stalenessBudgetHours}h budget.`,
  };
}

// Mirror of lib/freshnessArtifact.ts: report WHAT was found, not just the JSON.
function readArtifact(rootDir, relPath) {
  if (!relPath) return { kind: "absent" };
  const abs = join(rootDir, relPath);
  if (!existsSync(abs)) return { kind: "missing", path: relPath };
  try {
    return { kind: "ok", path: relPath, json: JSON.parse(readFileSync(abs, "utf8")) };
  } catch (err) {
    return { kind: "unreadable", path: relPath, error: err instanceof Error ? err.message : String(err) };
  }
}

// Mirror of lib/freshness.ts packArtifactReason: a declared row pack that is
// absent, unreadable or empty is unmeasurable, never fresh.
function packArtifactReason(read) {
  if (read.kind === "absent") {
    return "The registry declares a row pack but no artifact to read it from.";
  }
  if (read.kind === "missing") {
    return `Artifact ${read.path} is not present at runtime, so its rows cannot be counted.`;
  }
  if (read.kind === "unreadable") {
    return `Artifact ${read.path} could not be parsed: ${read.error}`;
  }
  if (!Array.isArray(read.json)) return `Artifact ${read.path} does not hold a row array.`;
  if (read.json.length === 0) return `Artifact ${read.path} is empty (0 rows).`;
  return null;
}

export function loadRegistry(rootDir = DEFAULT_ROOT) {
  const path = join(rootDir, "data", "freshness_registry.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Evaluate the whole registry against disk. Returns { results, breached }.
 * `now` and `rootDir` are injectable for tests.
 */
export async function evaluateFreshness({ now = new Date(), rootDir = DEFAULT_ROOT, registry } = {}) {
  const reg = registry ?? loadRegistry(rootDir);
  const results = await Promise.all(
    (reg.datasets ?? []).map(async (dataset) => {
      const spec = dataset.stamp ?? null;
      // Store-kind datasets have no committed artifact at all — their age comes
      // only from the durable store's real four-way read (unconfigured /
      // unreachable / empty / ok), dependency-free via a raw PostgREST fetch.
      if (spec?.kind === "store") {
        const read = await readDurableFeedStamp(spec.feedKey);
        const { observedAt, reason } = resolveStoreStamp(spec, read);
        return evaluateDataset(dataset, observedAt, now, reason);
      }
      // Mirror of lib/freshnessArtifact.ts resolveDatasetStamp: only a field stamp
      // lives inside the artifact, so only a field stamp opens one — plus a
      // declared row pack, whose rows are the finding whatever dates it.
      const opensArtifact =
        Boolean(dataset.artifact) && (spec?.kind === "field" || dataset.pack === true);
      const artifactRead = opensArtifact
        ? readArtifact(rootDir, dataset.artifact)
        : { kind: "absent" };
      if (dataset.pack === true) {
        const packReason = packArtifactReason(artifactRead);
        if (packReason) return evaluateDataset(dataset, null, now, packReason);
      }
      const { observedAt, reason } = resolveStamp(
        spec,
        spec?.kind === "field" ? artifactRead : { kind: "absent" },
      );
      return evaluateDataset(dataset, observedAt, now, reason);
    }),
  );
  const breached = results.some((r) => r.status === "stale" || r.status === "unknown");
  return { results, breached };
}

// Re-exported so validate-data can format identically.
export function formatFreshnessTable(results) {
  const rows = results.map((r) => ({
    status: r.status.toUpperCase(),
    id: r.id,
    age: r.ageHours === null ? "—" : `${r.ageHours}h`,
    budget: r.stalenessBudgetHours === null ? "—" : `${r.stalenessBudgetHours}h`,
    cadence: r.cadence,
  }));
  const widths = {
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    age: Math.max(3, ...rows.map((r) => r.age.length)),
    budget: Math.max(6, ...rows.map((r) => r.budget.length)),
  };
  const pad = (s, w) => String(s).padEnd(w);
  const lines = rows.map(
    (r) => `  ${pad(r.status, widths.status)}  ${pad(r.id, widths.id)}  ${pad(r.age, widths.age)} / ${pad(r.budget, widths.budget)}  ${r.cadence}`,
  );
  return lines.join("\n");
}

async function main() {
  const artifactOnly = process.argv.includes("--artifacts-only");
  const registry = loadRegistry(DEFAULT_ROOT);
  const selectedRegistry = artifactOnly
    ? {
        ...registry,
        datasets: (registry.datasets ?? []).filter((dataset) => dataset.stamp?.kind !== "store"),
      }
    : registry;
  const { results, breached } = await evaluateFreshness({ registry: selectedRegistry });
  console.log("Freshness registry check (data/freshness_registry.json)\n");
  if (artifactOnly) console.log("Scope: candidate artifact-backed feeds. Production store feeds use their own gate.\n");
  console.log(formatFreshnessTable(results));
  const stale = results.filter((r) => r.status === "stale");
  const unknown = results.filter((r) => r.status === "unknown");
  console.log("");
  if (breached) {
    // Two findings, reported apart. Stale means the data is old; unresolved means
    // the age could not be measured and says nothing about the data itself.
    if (stale.length) {
      console.log("  STALE (the data is over budget):");
      for (const r of stale) console.log(`    ✗ ${r.id}: ${r.detail}`);
    }
    if (unknown.length) {
      console.log("  UNRESOLVED (the age could not be determined):");
      for (const r of unknown) console.log(`    ? ${r.id}: ${r.detail}`);
    }
    console.log(`\nFRESHNESS CHECK FAILED: ${stale.length} stale, ${unknown.length} unresolved of ${results.length} datasets.`);
    process.exit(1);
  }
  console.log(`FRESHNESS CHECK PASSED: ${results.length} datasets within budget (or live/untracked).`);
}

// Run as a CLI only when invoked directly, not when imported by validate-data.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Freshness check crashed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
