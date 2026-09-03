// CityMCP "buzz" trim — the AI-synthesised press/review digest that
// `get_place` (deep:true) returns and the main client whitelist discards.
//
// Kept OUT of lib/citymcp/client.ts on purpose (another agent owns that
// file). We import its transport (`callCityMcpTool`) and trim ONLY:
//
//   buzz.value.summary     — an AI-written pros/cons paragraph
//   buzz.value.mentions[]  — press links (Infatuation, Tripadvisor, …)
//
// Honesty rules (non-negotiable):
//  - This is third-party, AI-synthesised content. The UI must label it as
//    such — never render it as community or editorial copy. This module
//    only guarantees the payload is trimmed + https-only; the label is the
//    renderer's job (see components/map/VenueBuzz.tsx).
//  - Mention links must be absolute https URLs; anything else is dropped.
//  - Nothing is invented: no summary + no mentions ⇒ null, render nothing.
//
// Fail-soft: transport errors propagate as CityMcpError; the API route
// catches and degrades. Results (including null) are cached in a small
// capped in-process Map so venue-sheet reopens don't hammer the upstream.

import {
  callCityMcpTool,
  CityMcpError,
  type CityMcpCallOptions,
} from "./client";

export type CityBuzzMention = { label: string; url: string };

export type CityBuzz = {
  /** AI-written pros/cons paragraph from the upstream digest. */
  summary?: string;
  /** Press mentions — https-only, capped. May be empty. */
  mentions: CityBuzzMention[];
};

const BUZZ_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const SUMMARY_MAX_CHARS = 1200;
const MENTIONS_CAP = 6;

type BuzzCacheEntry = { value: CityBuzz | null; expiresAt: number };
const buzzCache = new Map<string, BuzzCacheEntry>();

/** Test-only: drop all cached buzz entries. */
export function resetCityBuzzCache(): void {
  buzzCache.clear();
}

function setCappedCache(key: string, value: BuzzCacheEntry): void {
  if (buzzCache.has(key)) buzzCache.delete(key);
  buzzCache.set(key, value);
  while (buzzCache.size > CACHE_MAX_ENTRIES) {
    const oldest = buzzCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    buzzCache.delete(oldest);
  }
}

function pickString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

/** True only for absolute https URLs — http and everything else is dropped. */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Hostname fallback label ("www.theinfatuation.com" → "theinfatuation.com"). */
function hostLabel(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.length > 0 ? host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whitelist/trim an upstream `get_place` structuredContent down to the buzz
 * digest. Returns null when there is nothing renderable (no summary AND no
 * https mentions) — callers render nothing rather than a fabricated block.
 * Exported for tests.
 */
export function trimCityBuzz(raw: unknown): CityBuzz | null {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  // Upstream sometimes nests the dossier under `place` (mirrors trimCityPlace).
  const nested = obj.place && typeof obj.place === "object" ? (obj.place as Record<string, unknown>) : obj;

  const block = nested.buzz;
  if (!block || typeof block !== "object") return null;
  const value = (block as Record<string, unknown>).value;
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  let summary = pickString(v.summary);
  if (summary && summary.length > SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
  }

  const mentions: CityBuzzMention[] = [];
  if (Array.isArray(v.mentions)) {
    for (const item of v.mentions) {
      if (mentions.length >= MENTIONS_CAP) break;
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const url = pickString(m.url);
      if (!url || !isHttpsUrl(url)) continue;
      const label =
        pickString(m.label) ??
        pickString(m.name) ??
        pickString(m.title) ??
        hostLabel(url);
      if (!label) continue;
      mentions.push({ label, url });
    }
  }

  if (!summary && mentions.length === 0) return null;
  return { ...(summary ? { summary } : {}), mentions };
}

/**
 * Fetch `get_place` (deep:true) and trim it to the buzz digest. Cached
 * in-process for ~10min per id (null results cached too — "no buzz" is a
 * valid answer). Throws CityMcpError on transport failure; callers fail-soft.
 */
export async function fetchCityBuzz(
  id: string,
  opts: CityMcpCallOptions = {},
): Promise<CityBuzz | null> {
  if (!id) throw new CityMcpError("get_place buzz: id is required", "empty");
  const now = Date.now();
  const cached = buzzCache.get(id);
  if (cached && cached.expiresAt > now) return cached.value;

  const result = await callCityMcpTool<unknown>("get_place", { id, deep: true }, opts);
  const trimmed = trimCityBuzz(result.structuredContent);
  setCappedCache(id, { value: trimmed, expiresAt: now + BUZZ_TTL_MS });
  return trimmed;
}
