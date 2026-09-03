// Crawl Story: a no-auth, URL-encoded, shareable "crawl poster". The whole story
// travels in a `?s=` query param (base64url of compact JSON) — no accounts, no
// database, no migrations. A link IS the story. Decode is defensive: any
// malformed input returns null rather than throwing, so a garbage link degrades
// to a friendly empty state instead of a crash.

export type CrawlStop = {
  venueId: string;
  name: string;
  priceGbp?: number | null;
  note?: string;
};

export type CrawlStory = {
  title: string;
  caption: string;
  vibeTags: string[];
  stops: CrawlStop[];
  createdAt?: string;
};

// The curated set of vibe tags. Kept as an allowlist so a shared link can't
// smuggle arbitrary text into the tag chips — decode filters to this set.
export const VIBE_TAGS = [
  "cheap",
  "chaotic",
  "quiet pint",
  "old local",
  "date night",
  "coding pint",
  "last train",
  "riverside",
  "hidden gem",
  "first legal pint",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];

const VIBE_TAG_SET = new Set<string>(VIBE_TAGS);

export function isVibeTag(value: unknown): value is VibeTag {
  return typeof value === "string" && VIBE_TAG_SET.has(value);
}

// Keep the encoded story small: cap field lengths and stop counts so a link
// stays paste-able. These are generous — a normal crawl is well under them.
const MAX_TITLE = 80;
const MAX_CAPTION = 280;
const MAX_NAME = 80;
const MAX_NOTE = 160;
const MAX_STOPS = 12;
const MAX_TAGS = VIBE_TAGS.length;

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function coercePrice(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  // Two decimals is enough for a pint price; keeps the payload tidy.
  return Math.round(value * 100) / 100;
}

// --- base64url helpers (no dependency; work in edge/browser/node) -----------

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(input, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary =
    typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// --- normalisation ----------------------------------------------------------

function normaliseStops(raw: unknown): CrawlStop[] {
  if (!Array.isArray(raw)) return [];
  const stops: CrawlStop[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = clampText(record.name, MAX_NAME);
    if (!name) continue; // a stop with no name is not a stop
    const stop: CrawlStop = {
      venueId: clampText(record.venueId, MAX_NAME),
      name,
    };
    const price = coercePrice(record.priceGbp);
    if (price !== null) stop.priceGbp = price;
    const note = clampText(record.note, MAX_NOTE);
    if (note) stop.note = note;
    stops.push(stop);
    if (stops.length >= MAX_STOPS) break;
  }
  return stops;
}

function normaliseTags(raw: unknown): VibeTag[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: VibeTag[] = [];
  for (const item of raw) {
    if (isVibeTag(item) && !seen.has(item)) {
      seen.add(item);
      tags.push(item);
      if (tags.length >= MAX_TAGS) break;
    }
  }
  return tags;
}

// Coerce any input into a well-formed CrawlStory. Used by both encode (so we
// never serialise junk) and decode (so a hostile link can't inject bad shapes).
function normaliseStory(raw: unknown): CrawlStory {
  const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const story: CrawlStory = {
    title: clampText(record.title, MAX_TITLE),
    caption: clampText(record.caption, MAX_CAPTION),
    vibeTags: normaliseTags(record.vibeTags),
    stops: normaliseStops(record.stops),
  };
  const createdAt = clampText(record.createdAt, 40);
  if (createdAt) story.createdAt = createdAt;
  return story;
}

// --- public API -------------------------------------------------------------

export function encodeCrawlStory(story: CrawlStory): string {
  // Serialise a normalised copy so the encoded payload is always well-formed.
  const clean = normaliseStory(story);
  // Compact keys keep the URL short. Order-preserving arrays; omit empties.
  const payload = {
    t: clean.title,
    c: clean.caption,
    v: clean.vibeTags,
    s: clean.stops.map((stop) => {
      const compact: Record<string, unknown> = { i: stop.venueId, n: stop.name };
      if (typeof stop.priceGbp === "number") compact.p = stop.priceGbp;
      if (stop.note) compact.m = stop.note;
      return compact;
    }),
    ...(clean.createdAt ? { d: clean.createdAt } : {}),
  };
  return toBase64Url(JSON.stringify(payload));
}

// NEVER throws. Any malformed input (null, "", garbage base64, non-object JSON)
// returns null so callers can fall back to a friendly empty state.
export function decodeCrawlStory(param: string | null | undefined): CrawlStory | null {
  if (typeof param !== "string" || param.length === 0) return null;
  try {
    const json = fromBase64Url(param);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    // Map compact keys back to the full shape, then normalise/validate.
    const story = normaliseStory({
      title: parsed.t,
      caption: parsed.c,
      vibeTags: parsed.v,
      stops: Array.isArray(parsed.s)
        ? (parsed.s as unknown[]).map((stop) => {
            const record = (stop && typeof stop === "object"
              ? stop
              : {}) as Record<string, unknown>;
            return {
              venueId: record.i,
              name: record.n,
              priceGbp: record.p,
              note: record.m,
            };
          })
        : [],
      createdAt: parsed.d,
    });
    // A story with no stops and no title carries nothing worth showing.
    if (story.stops.length === 0 && !story.title && !story.caption) return null;
    return story;
  } catch {
    return null;
  }
}

// Receipt-style total: sum stop prices, ignoring nullish/absent ones.
export function totalGbp(story: CrawlStory): number {
  return story.stops.reduce(
    (sum, stop) => (typeof stop.priceGbp === "number" ? sum + stop.priceGbp : sum),
    0,
  );
}
