import "server-only";

// Server-side national UK pub name search over the generated compact index.
// Phones never download the country-wide pack; this module opens the file once
// per instance and answers GET /api/map-search.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { UK_PUB_SEARCH_INDEX_FILE } from "@/lib/ukPubSearchIndexFile.mjs";
import { ukBaseIdFor, type UkBasePub } from "@/lib/ukBasePubs";
import { normaliseUkPlaceQuery } from "@/lib/ukPlaceSearch";

const INDEX_FILE = join(
  /* turbopackIgnore: true */ process.cwd(),
  UK_PUB_SEARCH_INDEX_FILE,
);

export type UkNationalPubHit = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

type IndexRow = {
  osmRef: string;
  name: string;
  search: string;
  address: string;
  lat: number;
  lng: number;
};

let rows: IndexRow[] | null = null;
let reported = false;

function matchTier(hay: string, query: string): number | null {
  if (!hay) return null;
  if (hay === query) return 0;
  if (hay.startsWith(query) || hay.split(" ").some((word) => word.startsWith(query))) {
    return 1;
  }
  if (query.length >= 2 && hay.includes(query)) return 2;
  return null;
}

function parseIndex(raw: unknown): IndexRow[] {
  if (!raw || typeof raw !== "object") throw new Error("index root missing");
  const pubs = (raw as { pubs?: unknown }).pubs;
  if (!Array.isArray(pubs)) throw new Error("index pubs missing");
  const parsed: IndexRow[] = [];
  for (const value of pubs) {
    if (!Array.isArray(value) || value.length < 5) continue;
    const [osmRef, name, address, lat, lng] = value;
    if (typeof osmRef !== "string" || !osmRef) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    if (typeof lat !== "number" || !Number.isFinite(lat)) continue;
    if (typeof lng !== "number" || !Number.isFinite(lng)) continue;
    parsed.push({
      osmRef,
      name: name.trim(),
      search: normaliseUkPlaceQuery(name),
      address: typeof address === "string" ? address : "",
      lat,
      lng,
    });
  }
  if (parsed.length === 0) throw new Error("index has no usable rows");
  return parsed;
}

function getRows(): IndexRow[] | null {
  if (rows) return rows;
  try {
    const raw = JSON.parse(
      readFileSync(/* turbopackIgnore: true */ INDEX_FILE, "utf8"),
    ) as unknown;
    rows = parseIndex(raw);
    reported = false;
    return rows;
  } catch (error) {
    if (!reported) {
      reported = true;
      console.error(
        `[uk-pub-search] ${UK_PUB_SEARCH_INDEX_FILE} is unreadable; national pub search is degraded`,
        error,
      );
    }
    return null;
  }
}

/** Test-only: inject a parsed index (or clear with null). */
export function __setUkNationalPubSearchIndexForTests(
  raw: unknown | null,
): void {
  rows = raw === null ? null : parseIndex(raw);
  reported = false;
}

export function searchUkNationalPubs(
  rawQuery: string,
  limit = 8,
): { status: "ready" | "degraded"; hits: UkNationalPubHit[] } {
  const query = normaliseUkPlaceQuery(rawQuery);
  if (query.length < 2 || limit <= 0) {
    return { status: getRows() ? "ready" : "degraded", hits: [] };
  }
  const index = getRows();
  if (!index) return { status: "degraded", hits: [] };

  const scored: { tier: number; row: IndexRow }[] = [];
  for (const row of index) {
    const tier = matchTier(row.search, query);
    if (tier === null) continue;
    scored.push({ tier, row });
  }

  scored.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier - right.tier;
    return left.row.name.localeCompare(right.row.name, "en-GB");
  });

  const hits = scored.slice(0, limit).map(({ row }) => ({
    id: ukBaseIdFor(row.osmRef),
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
  }));

  return { status: "ready", hits };
}

export function nationalHitToUkBasePub(hit: UkNationalPubHit): UkBasePub {
  return {
    id: hit.id,
    name: hit.name,
    address: hit.address,
    lat: hit.lat,
    lng: hit.lng,
    curatedVenueId: "",
  };
}
