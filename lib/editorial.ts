// Editorial overlay policy: what a stored pick is, what the rail may say,
// and how a failed read differs from a quiet week. The XML parse and the
// allowlist live in lib/editorialRss.mjs so the Node poller can share them.

import {
  EDITORIAL_ITEM_KEYS as RSS_ITEM_KEYS,
  attributionLabelForSource,
  dedupeEditorialItems,
  licenceForSource,
  storedEditorialItem,
  type EditorialItem,
} from "@/lib/editorialRss.mjs";

export const EDITORIAL_RAIL_TITLE = "Also picked this week";
export const EDITORIAL_EMPTY_LINE = "No picks this week.";
export const EDITORIAL_DEGRADED_LINE = "Some picks could not be checked.";
export const EDITORIAL_DEGRADED_EMPTY_LINE = "Picks could not be checked.";
// A snapshot past EDITORIAL_SNAPSHOT_MAX_AGE_MS withholds its rows, so the
// reader has nothing to show AND nothing we can vouch for. "Picks need a fresh
// check" described our own maintenance to a drinker; this says what they get
// without claiming the week is empty, which we do not know.
export const EDITORIAL_STALE_LINE = "No fresh picks to show just now.";
export const EDITORIAL_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// A generated overlay is a build artifact, not a live feed. Once it is two
// days old, its current-week rows are withheld until a new poll lands.
export const EDITORIAL_SNAPSHOT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const EDITORIAL_RAIL_LIMIT = 12;
export const EDITORIAL_ITEM_KEYS = RSS_ITEM_KEYS;

export const EDITORIAL_OGL_ATTRIBUTION =
  "Contains public sector information licensed under the Open Government Licence v3.0.";
export const EDITORIAL_OGL_URL =
  "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";

export type { EditorialItem };

export type EditorialSnapshot = {
  version: 1;
  generatedAt: string;
  status: "ready" | "degraded";
  items: EditorialItem[];
};

export function editorialViaChip(label: string): string {
  return `via ${label}`;
}

export function editorialOglMark(licence: string): "OGL" | null {
  return licence === "ogl" ? "OGL" : null;
}

export function editorialOglMarkForSource(sourceId: string): "OGL" | null {
  return editorialOglMark(licenceForSource(sourceId));
}

export function editorialOglAttributionForSource(
  sourceId: string,
): { label: string; url: string } | null {
  return editorialOglMarkForSource(sourceId)
    ? { label: EDITORIAL_OGL_ATTRIBUTION, url: EDITORIAL_OGL_URL }
    : null;
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readItem(value: unknown): EditorialItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.source_id !== "string" || row.source_id.trim().length === 0) return null;
  if (typeof row.title !== "string" || row.title.trim().length === 0) return null;
  if (!isHttpUrl(row.canonical_url)) return null;
  if (!isIso(row.published_at)) return null;
  if (typeof row.excerpt !== "string") return null;
  if (typeof row.attribution_label !== "string" || row.attribution_label.trim().length === 0) {
    return null;
  }
  if (row.attribution_label !== attributionLabelForSource(row.source_id)) return null;
  return storedEditorialItem({
    source_id: row.source_id,
    title: row.title,
    canonical_url: row.canonical_url,
    published_at: new Date(Date.parse(row.published_at)).toISOString(),
    excerpt: row.excerpt.slice(0, 240),
    attribution_label: row.attribution_label,
  });
}

export function parseEditorialSnapshot(raw: unknown): EditorialSnapshot {
  if (!raw || typeof raw !== "object") {
    return { version: 1, generatedAt: "", status: "degraded", items: [] };
  }
  const body = raw as Record<string, unknown>;
  const rawItems = Array.isArray(body.items) ? body.items : null;
  const parsedItems = rawItems
    ? rawItems.map(readItem).filter((item): item is EditorialItem => item !== null)
    : [];
  const items = dedupeEditorialItems(parsedItems);
  const droppedRows = rawItems !== null && parsedItems.length !== rawItems.length;
  const status = body.status === "ready" && !droppedRows ? "ready" : "degraded";
  const generatedAt = isIso(body.generatedAt) ? body.generatedAt : "";
  if (body.status !== "ready" && body.status !== "degraded") {
    return { version: 1, generatedAt, status: "degraded", items };
  }
  if (rawItems === null) {
    return { version: 1, generatedAt, status: "degraded", items: [] };
  }
  return { version: 1, generatedAt, status, items };
}

export function editorialSnapshotIsStale(
  snapshot: EditorialSnapshot,
  now: number = Date.now(),
): boolean {
  if (snapshot.status !== "ready") return false;
  const generatedAt = Date.parse(snapshot.generatedAt);
  return (
    !Number.isFinite(generatedAt) ||
    generatedAt > now ||
    now - generatedAt > EDITORIAL_SNAPSHOT_MAX_AGE_MS
  );
}

export function editorialThisWeekItems(
  snapshot: EditorialSnapshot,
  now: number = Date.now(),
): EditorialItem[] {
  const from = now - EDITORIAL_WEEK_MS;
  return snapshot.items
    .filter((item) => {
      const ms = Date.parse(item.published_at);
      return Number.isFinite(ms) && ms >= from && ms <= now;
    })
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
    .slice(0, EDITORIAL_RAIL_LIMIT);
}
