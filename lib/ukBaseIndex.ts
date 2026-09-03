import "server-only";

import { promises as fs } from "fs";
import path from "path";

import type { ShardEntry } from "@/lib/slimShards";
import {
  UK_BASE_MANIFEST_PATH,
  UK_BASE_SHARD_VERSION,
  isUkBaseId,
  parseUkBaseManifest,
  parseUkBaseShardForEntry,
  type UkBasePub,
} from "@/lib/ukBasePubs";

// Server-only membership index for the UK BASE layer, the sibling of
// lib/venueIndex.ts for `venue-uk-…` ids. Base pubs deliberately live OUTSIDE
// the curated venue index (that is what keeps them out of search, the price
// filters and the crawl router), but they ARE a price-submission target — so
// /api/price-submit needs a way to tell a real base pub from a fabricated
// `venue-uk-…` id. Never accept an id on shape alone: an unvalidated id could
// scope its own rate-limit bucket and litter the community-price store, which
// is exactly the hole the slim-index membership check closed.
//
// Cold `?sel=venue-uk-*` restore also needs the FULL record (name, address,
// coords) before the viewport stream has that cell, so `lookupUkBasePub` reads
// the same shard pack and returns the pub or an explicit miss — never a
// guessed one.
//
// It reads the committed shard pack with `fs` — so import it ONLY
// from server code. Client code streams the same shards per viewport through
// lib/ukBasePubs.ts; the id decode is shared (parseUkBaseShard), so the two
// sides can never disagree about which ids exist.
//
// Never throws. A read/parse failure returns an explicit unavailable result,
// each shard is cached individually so a transient per-shard failure retries
// on the next call, and the merged set is only memoized once every shard loads.

export type UkBaseIdIndexResult =
  | { status: "ready"; ids: Set<string> }
  | { status: "unavailable" };

export type UkBasePubLookupResult =
  | { status: "ready"; pub: UkBasePub }
  | { status: "missing" }
  | { status: "unavailable" };

let cached: UkBaseIdIndexResult | null = null;
const shardIdCache = new Map<string, string[]>();
const shardPubCache = new Map<string, UkBasePub[]>();
/** id → shard url, built once every shard has loaded successfully. */
let idToShardUrl: Map<string, string> | null = null;

function publicDataPath(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

async function readManifest() {
  try {
    return parseUkBaseManifest(
      JSON.parse(
        await fs.readFile(
          /* turbopackIgnore: true */ publicDataPath(UK_BASE_MANIFEST_PATH),
          "utf8",
        ),
      ),
    );
  } catch {
    return null;
  }
}

function manifestIsUsable(
  manifest: ReturnType<typeof parseUkBaseManifest>,
): manifest is NonNullable<ReturnType<typeof parseUkBaseManifest>> {
  return Boolean(
    manifest &&
      manifest.version === UK_BASE_SHARD_VERSION &&
      manifest.shards.length > 0 &&
      !manifest.shards.some(
        (shard) =>
          !Number.isSafeInteger(shard.count) ||
          shard.count <= 0 ||
          !shard.url.startsWith("/data/uk_base/") ||
          shard.url.split("/").includes(".."),
      ),
  );
}

async function readShardPubs(shard: ShardEntry): Promise<UkBasePub[] | null> {
  const cachedPubs = shardPubCache.get(shard.url);
  if (cachedPubs) return cachedPubs;
  const body: unknown = JSON.parse(
    await fs.readFile(
      /* turbopackIgnore: true */ publicDataPath(shard.url),
      "utf8",
    ),
  );
  const pubs = parseUkBaseShardForEntry(body, shard);
  if (!pubs) return null;
  shardPubCache.set(shard.url, pubs);
  shardIdCache.set(
    shard.url,
    pubs.map((pub) => pub.id),
  );
  return pubs;
}

async function readShardIds(shard: ShardEntry): Promise<string[] | null> {
  const cachedIds = shardIdCache.get(shard.url);
  if (cachedIds) return cachedIds;
  const pubs = await readShardPubs(shard);
  return pubs ? pubs.map((pub) => pub.id) : null;
}

async function ensureIdToShardUrl(): Promise<Map<string, string> | null> {
  if (idToShardUrl) return idToShardUrl;
  const manifest = await readManifest();
  if (!manifestIsUsable(manifest)) return null;
  for (const shard of manifest.shards) {
    if (shardIdCache.has(shard.url)) continue;
    try {
      const ids = await readShardIds(shard);
      if (ids) shardIdCache.set(shard.url, ids);
    } catch {
      // Retry on the next call without publishing a partial authority.
    }
  }
  const index = new Map<string, string>();
  let expectedCount = 0;
  for (const shard of manifest.shards) {
    const ids = shardIdCache.get(shard.url);
    if (!ids) return null;
    expectedCount += shard.count;
    for (const id of ids) index.set(id, shard.url);
  }
  if (index.size !== expectedCount) return null;
  idToShardUrl = index;
  return idToShardUrl;
}

export async function getUkBaseIdIndex(): Promise<UkBaseIdIndexResult> {
  if (cached) return cached;
  const map = await ensureIdToShardUrl();
  if (!map) return { status: "unavailable" };
  cached = { status: "ready", ids: new Set(map.keys()) };
  return cached;
}

/**
 * Resolve one `venue-uk-*` id to its shard record for cold deep-link restore.
 * Fail closed: a well-formed id the pack does not carry is `missing`; a pack
 * read failure is `unavailable` (never treated as an empty city).
 */
export async function lookupUkBasePub(id: string): Promise<UkBasePubLookupResult> {
  if (!isUkBaseId(id)) return { status: "missing" };
  const map = await ensureIdToShardUrl();
  if (!map) return { status: "unavailable" };
  const shardUrl = map.get(id);
  if (!shardUrl) return { status: "missing" };
  const manifest = await readManifest();
  if (!manifestIsUsable(manifest)) return { status: "unavailable" };
  const shard = manifest.shards.find((entry) => entry.url === shardUrl);
  if (!shard) return { status: "unavailable" };
  try {
    const pubs = await readShardPubs(shard);
    if (!pubs) return { status: "unavailable" };
    const pub = pubs.find((row) => row.id === id);
    return pub ? { status: "ready", pub } : { status: "missing" };
  } catch {
    return { status: "unavailable" };
  }
}

export function resetUkBaseIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    shardIdCache.clear();
    shardPubCache.clear();
    idToShardUrl = null;
  }
}
