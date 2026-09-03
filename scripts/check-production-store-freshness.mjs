import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Bootstrap only. This exact stamp was written to production feed_freshness by
// the 2026-08-21 operator refresh before stampSource shipped. Once production
// serves stampSource, this equality is no longer consulted. Never widen this
// to a date range or accept an arbitrary artifact match.
const LEGACY_WHATS_ON_DURABLE_STAMP = "2026-08-21T13:59:12.570Z";

function artifactObservedAtById(registry) {
  return Object.fromEntries(
    (registry.datasets ?? []).flatMap((dataset) => {
      if (!dataset.artifact || dataset.stamp?.kind !== "field") return [];
      try {
        const artifact = JSON.parse(readFileSync(join(ROOT, dataset.artifact), "utf8"));
        const observedAt = artifact?.[dataset.stamp.pointer];
        return typeof observedAt === "string" ? [[dataset.id, observedAt]] : [];
      } catch {
        return [];
      }
    }),
  );
}

export async function checkProductionStoreFreshness({
  registry,
  fetchImpl = fetch,
  url = "https://pubmaxxing.com/api/freshness",
  now = Date.now(),
  artifactStamps = artifactObservedAtById(registry),
}) {
  const storeIds = new Set([
    "whats_on",
    ...(
    (registry.datasets ?? [])
      .filter((dataset) => dataset.stamp?.kind === "store")
      .map((dataset) => dataset.id)
    ),
  ]);
  const gateUrl = new URL(url);
  gateUrl.searchParams.set("release_gate", String(now));
  const response = await fetchImpl(gateUrl, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Production freshness endpoint returned ${response.status}.`);
  const body = await response.json();
  const byId = new Map((body.datasets ?? []).map((dataset) => [dataset.id, dataset]));
  const failures = [];
  for (const id of storeIds) {
    const result = byId.get(id);
    if (!result || !["fresh", "untracked"].includes(result.status)) {
      failures.push(`${id}: ${result?.status ?? "missing"} - ${result?.detail ?? "No result"}`);
    } else if (id === "whats_on" && result.stampSource !== "durable-store") {
      // Rollout compatibility for the production version that predates
      // stampSource: a value different from the bundled artifact can only have
      // come from the durable overlay. New responses must name that source.
      const legacyDurableProof =
        result.stampSource === undefined &&
        typeof result.observedAt === "string" &&
        ((typeof artifactStamps[id] === "string" &&
          Date.parse(result.observedAt) !== Date.parse(artifactStamps[id])) ||
          Date.parse(result.observedAt) === Date.parse(LEGACY_WHATS_ON_DURABLE_STAMP));
      if (!legacyDurableProof) {
        failures.push(`${id}: ${result.status} - durable store stamp required`);
      }
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return [...storeIds];
}

async function main() {
  const registry = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
  const checked = await checkProductionStoreFreshness({ registry });
  console.log(`PRODUCTION STORE FRESHNESS PASSED: ${checked.join(", ") || "no store feeds"}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`PRODUCTION STORE FRESHNESS FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
