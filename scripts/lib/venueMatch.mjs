/**
 * Shared venue-key resolution for Firecrawl price harvesters.
 */

export function normaliseVenueKeyPart(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function venueGroupingKey(row) {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    row.latitude.toFixed(5),
    row.longitude.toFixed(5),
  ].join("|");
}

export function stableVenueIdFromKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

/** Strip noise for fuzzy pub-name matching; keep arms/tavern for disambiguation. */
export function normalisePubName(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildVenueIndexes(dataset) {
  const idToKey = new Map();
  const nameToKeys = new Map();
  const rowsByKey = new Map();
  for (const row of dataset) {
    const key = venueGroupingKey(row);
    const id = stableVenueIdFromKey(key);
    idToKey.set(id, key);
    rowsByKey.set(key, row);
    const norm = normalisePubName(row.pub_name);
    const list = nameToKeys.get(norm) ?? [];
    list.push(key);
    nameToKeys.set(norm, list);
  }
  return { idToKey, nameToKeys, rowsByKey };
}

export function menuUrlToVenueId(enrichment) {
  const map = new Map();
  for (const [venueId, rec] of Object.entries(enrichment.venues ?? {})) {
    if (rec.menuUrl) map.set(rec.menuUrl.replace(/\/$/, ""), venueId);
  }
  return map;
}

/** Greene King slug → search tokens (pub name fragments + area hints). */
export const GK_SLUG_HINTS = {
  "goat-tavern-mayfair": ["goat", "tavern", "stafford"],
  "grafton-arms": ["grafton", "strutton"],
  "leicester-arms": ["leicester", "glasshouse"],
  "masons-arms": ["masons", "maddox"],
  "travellers-tavern": ["travellers", "elizabeth"],
  "lamb-and-flag": ["lamb", "flag", "covent"],
  "golden-fleece": ["golden", "fleece"],
  "five-bells": ["five", "bells"],
  "marlborough-arms": ["marlborough"],
  "kings-arms-greenwich": ["kings", "greenwich", "king william"],
  "new-cross-house": ["new cross", "house"],
  "coach-house-at-the-george": ["coach", "george"],
  "county-arms": ["county", "arms"],
  "brockley-jack": ["brockley", "jack"],
  "buff": ["buff"],
  "bunch-of-grapes": ["bunch", "grapes"],
  "greene-man": ["greene", "man"],
  "new-explorer": ["explorer"],
};

export function resolveVenueKeyFromHints(hints, indexes) {
  if (!hints?.length) return null;
  let best = null;
  let bestScore = 0;
  for (const [norm, keyList] of indexes.nameToKeys.entries()) {
    const row = indexes.rowsByKey.get(keyList[0]);
    const haystack = `${norm} ${normalisePubName(row?.address ?? "")}`;
    const score = hints.filter((h) => haystack.includes(h)).length;
    if (score > bestScore && score >= Math.min(2, hints.length)) {
      bestScore = score;
      best = keyList[0];
    }
  }
  return best;
}

export function resolveVenueKeyFromPubName(pubName, indexes) {
  if (!pubName) return null;
  const norm = normalisePubName(pubName);
  const exact = indexes.nameToKeys.get(norm);
  if (exact?.length === 1) return exact[0];
  if (exact?.length > 1) return exact[0];

  const tokens = norm.split(" ").filter((t) => t.length > 2);
  return resolveVenueKeyFromHints(tokens, indexes);
}

export function slugFromMbplcDrinksUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const drinksIdx = parts.lastIndexOf("drinks");
    if (drinksIdx < 2) return null;
    return parts[drinksIdx - 1] ?? null;
  } catch {
    return null;
  }
}

export function mergeDrinkUpdates(existing, incoming) {
  const byKey = new Map();
  for (const row of existing) {
    const k = `${row.venueKey}|${row.drinkName}|${row.category}|${row.source?.url ?? ""}`;
    byKey.set(k, row);
  }
  for (const row of incoming) {
    const k = `${row.venueKey}|${row.drinkName}|${row.category}|${row.source?.url ?? ""}`;
    byKey.set(k, row);
  }
  return [...byKey.values()];
}
