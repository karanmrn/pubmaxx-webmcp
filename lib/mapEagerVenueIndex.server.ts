import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MAP_EAGER_VENUE_INDEX_FILE } from "@/lib/mapEagerVenueIndexFile.mjs";
import type { MapSelectableVenueIds } from "@/lib/pricedLanding";

// Which pubs a `?sel=` arrival can actually open.
//
// The slim index is SHARDED: the map loads only the opening cells, but a
// selected venue can still hydrate its detail directly. Server surfaces read
// every shipped spatial cell for this selection gate, without adding any data
// to the browser's first payload.
//
// The answer is TRI-STATE by way of null: a read that could not run says
// NEITHER "selectable" nor "not selectable", and a caller then names no pub
// rather than one the map would drop.

let cached: ReadonlySet<string> | null = null;

function parseVenueIds(payload: unknown): ReadonlySet<string> | null {
  const rows = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null &&
        Array.isArray((payload as { rows?: unknown }).rows)
      ? (payload as { rows: unknown[] }).rows
      : null;
  if (!rows) return null;
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && id) ids.add(id);
  }
  // An empty core shard is not a real state, so read it as a failed read
  // rather than as a map that can open nothing.
  return ids.size > 0 ? ids : null;
}

/** The eager shard's venue ids, or null when the shard could not be read. */
export async function loadMapSelectableVenueIds(): Promise<MapSelectableVenueIds> {
  if (cached) return cached;
  try {
    const root = join(
      /* turbopackIgnore: true */ process.cwd(),
      "public",
      "data",
    );
    const coreFile = join(root, MAP_EAGER_VENUE_INDEX_FILE.replace(/^public\/data\//, ""));
    const files = [coreFile];
    const manifest = JSON.parse(
      await readFile(join(root, "venues_slim.manifest.json"), "utf8"),
    ) as { shards?: Array<{ core?: boolean; url?: string }> };
    if (!Array.isArray(manifest.shards)) return null;
    for (const shard of manifest.shards) {
      if (typeof shard !== "object" || shard === null) return null;
      if (typeof shard.core !== "boolean") return null;
      if (shard.core) continue;
      if (typeof shard.url !== "string") return null;
      const name = shard.url.split("/").at(-1);
      if (!name?.startsWith("venues_slim.cell.") || !name.endsWith(".json")) return null;
      files.push(join(root, name));
    }
    const payloads = await Promise.all(
      files.map((file) => readFile(/* turbopackIgnore: true */ file, "utf8")),
    );
    const ids = new Set<string>();
    for (const payload of payloads) {
      const parsed = parseVenueIds(JSON.parse(payload) as unknown);
      if (!parsed) return null;
      for (const id of parsed) ids.add(id);
    }
    const parsed = ids.size > 0 ? ids : null;
    // A failed read is not cached, so the next request tries again.
    if (parsed) cached = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function resetMapEagerVenueIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
  }
}
