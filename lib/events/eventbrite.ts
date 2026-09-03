// Eventbrite provider for the runtime events seam (lib/events/provider.ts).
//
// CAPABILITY REALITY (probed 2026-07-18 against a live private token via
// /v3/users/me):
//   * Eventbrite REMOVED public event search (GET /v3/events/search/) in 2019;
//     it 404s today. A private token grants NO London-wide discovery.
//   * What a private token CAN reach: the events owned by the authenticated
//     account's OWN organizations (GET /v3/organizations/{id}/events/), a
//     single event/venue by known id, and public reference data (categories).
//   * The probed token's account currently owns ZERO organizations, so this
//     provider legally contributes ZERO rows right now. It is wired honestly:
//     it surfaces ONLY the account's own live events and lights up with no code
//     change if/when the owner creates events under this Eventbrite account.
//
// This is the same "provenance non-negotiable, honest partial" posture as the
// Ticketmaster/Skiddle build-time providers: no scraping, no faked discovery.
// Every row deep-links back to its own eventbrite.com event page.

import {
  isHttpUrl,
  isValidWhatsOnRow,
  londonServiceDayBounds,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import type { EventsProvider, EventsProviderContext } from "@/lib/events/provider";

const EVENTBRITE_BASE = "https://www.eventbriteapi.com/v3";

export const EVENTBRITE_SOURCE = {
  label: "Eventbrite",
  url: "https://www.eventbrite.com/",
};

// Only unambiguous Eventbrite category ids map onto our four kinds — mirrors the
// conservative Ticketmaster Music/Sports mapping. Everything else (theatre,
// comedy, food, community, …) is DROPPED rather than forced into a kind it is
// not. 103 = Music, 108 = Sports & Fitness (Eventbrite public category ids).
export const EVENTBRITE_CATEGORY_KIND: Record<string, WhatsOnKind> = {
  "103": "music",
  "108": "sport",
};

// Read the token at call time (not module load) so a test or a late-provisioned
// env var is always honoured. Never logged, never returned to a caller.
function readToken(): string | undefined {
  const t = process.env.EVENTBRITE_API_TOKEN;
  return typeof t === "string" && t.trim().length > 0 ? t.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Pure mapping (exported for tests — never touches the network)
// ---------------------------------------------------------------------------

type EventbriteEvent = {
  id?: unknown;
  name?: { text?: unknown } | null;
  url?: unknown;
  start?: { utc?: unknown } | null;
  end?: { utc?: unknown } | null;
  category_id?: unknown;
  is_free?: unknown;
  venue?: {
    name?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  } | null;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map one Eventbrite v3 event (expand=venue) to a WhatsOnRow, or null if it
 * cannot be honestly represented (unmapped category, no venue name, no start,
 * no link). `now` gates the spine's own observedAt guard.
 */
export function mapEventbriteEvent(
  event: EventbriteEvent,
  opts: { observedAt: string; now: number },
): WhatsOnRow | null {
  if (!event || typeof event !== "object") return null;

  const kind = nonEmptyString(event.category_id)
    ? EVENTBRITE_CATEGORY_KIND[event.category_id.trim()]
    : undefined;
  if (!kind) return null;

  const placeName = event.venue?.name;
  if (!nonEmptyString(placeName)) return null;

  const url = event.url;
  if (!isHttpUrl(url)) return null; // provenance non-negotiable

  const title = event.name?.text;
  if (!nonEmptyString(title)) return null;

  const startsAt = event.start?.utc;
  if (!nonEmptyString(startsAt) || !Number.isFinite(Date.parse(startsAt))) return null;

  const row: WhatsOnRow = {
    id: stableId("events-eb", `${nonEmptyString(event.id) ? event.id : title}|${placeName}|${startsAt}`),
    placeName: placeName.trim(),
    kind,
    startsAt: new Date(Date.parse(startsAt)).toISOString(),
    title: title.trim(),
    source: { ...EVENTBRITE_SOURCE, url: (url as string).trim() },
    observedAt: opts.observedAt,
    confidence: "listed",
  };

  const endsAt = event.end?.utc;
  if (nonEmptyString(endsAt) && Number.isFinite(Date.parse(endsAt))) {
    row.endsAt = new Date(Date.parse(endsAt)).toISOString();
  }
  const lat = finiteNum(event.venue?.latitude);
  const lng = finiteNum(event.venue?.longitude);
  if (lat !== null) row.lat = lat;
  if (lng !== null) row.lng = lng;
  if (event.is_free === true) row.priceGbp = 0;

  return isValidWhatsOnRow(row, opts.now) ? row : null;
}

// FNV-1a stable id (matches the spine's stableId flavour in lib/whatsOn.ts).
function stableId(prefix: string, input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

/** Map a raw org-events payload to rows (pure — used by the fetcher + tests). */
export function normaliseEventbriteEvents(
  payload: unknown,
  opts: { observedAt: string; now: number },
): WhatsOnRow[] {
  const events = (payload as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const rows: WhatsOnRow[] = [];
  for (const event of events) {
    const row = mapEventbriteEvent(event as EventbriteEvent, opts);
    if (row) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fetch flow (own-org events only) + short in-process cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ORGS = 20;
const PAGE_SIZE = 50;

type CacheEntry = { at: number; windowStart: string; rows: WhatsOnRow[] };
let cache: CacheEntry | null = null;

/** Test seam: clear the in-process cache between cases. */
export function resetEventbriteCache(): void {
  cache = null;
}

// Eventbrite's start_date.range_* filters reject millisecond precision — trim to
// whole-second Z (e.g. 2026-07-18T16:00:00Z).
function toEventbriteInstant(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

async function ebGet(
  path: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(`${EVENTBRITE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Eventbrite API returned ${res.status} for ${path}`);
  return res.json();
}

/**
 * Fetch the authenticated account's own live tonight-window events, mapped to
 * WhatsOnRow[]. Discovery of events the account does not own is IMPOSSIBLE with
 * a private token (public search was removed in 2019), so this is the complete
 * legal surface. Cached in-process for CACHE_TTL_MS keyed by the tonight window.
 */
export async function fetchEventbriteTonightRows(
  ctx: EventsProviderContext,
): Promise<WhatsOnRow[]> {
  const token = readToken();
  if (!token) return [];

  const { start, end } = londonServiceDayBounds(ctx.now);
  if (cache && cache.windowStart === start && ctx.now - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }

  const fetchImpl = ctx.fetchImpl ?? fetch;
  const observedAt = new Date(ctx.now).toISOString();

  const orgsPayload = (await ebGet("/users/me/organizations/", token, fetchImpl)) as {
    organizations?: Array<{ id?: unknown }>;
  };
  const orgIds = (Array.isArray(orgsPayload?.organizations) ? orgsPayload.organizations : [])
    .map((o) => (nonEmptyString(o?.id) ? o.id.trim() : null))
    .filter((id): id is string => id !== null)
    .slice(0, MAX_ORGS);

  const rangeStart = encodeURIComponent(toEventbriteInstant(start));
  const rangeEnd = encodeURIComponent(toEventbriteInstant(end));

  const all: WhatsOnRow[] = [];
  for (const orgId of orgIds) {
    const path =
      `/organizations/${encodeURIComponent(orgId)}/events/` +
      `?status=live&order_by=start_asc&expand=venue&page_size=${PAGE_SIZE}` +
      `&start_date.range_start=${rangeStart}&start_date.range_end=${rangeEnd}`;
    const payload = await ebGet(path, token, fetchImpl);
    all.push(...normaliseEventbriteEvents(payload, { observedAt, now: ctx.now }));
  }

  cache = { at: ctx.now, windowStart: start, rows: all };
  return all;
}

/** The Eventbrite provider for the runtime events aggregator. */
export function createEventbriteProvider(): EventsProvider {
  return {
    name: "eventbrite",
    isConfigured: () => readToken() !== undefined,
    fetchTonight: (ctx) => fetchEventbriteTonightRows(ctx),
  };
}
