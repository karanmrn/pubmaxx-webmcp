// InstaPint feed model — a pure, testable normalizer + cursor pagination over
// the public Pint Drops API. The /feed page fetches `/api/pint-drops`, maps each
// DTO through normalizePintDrop, then filters/paginates with the helpers here.
// No React, no fetch, no side effects — every export is a pure function so the
// whole feed is covered by __tests__/feed.test.ts.

import type { CheckIn } from "@/lib/checkIn";
import type { Provenance } from "@/lib/curation";
import { rankForYou, type ForYouContext } from "@/lib/forYou";
import { isLiveLastTrainDecision } from "@/lib/lastTrainBadge";
import { getNightArea } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import type { LastPintDecisionKind } from "@/lib/tfl";
import { venueMapUrl as buildVenueMapUrl } from "@/lib/venueMapUrl";
import { DAY_MS } from "@/lib/dayMs";

// The public read shape as it arrives over the wire from GET /api/pint-drops
// ({ drops: [...] }). Kept structural (not imported from the store's DTO type)
// so this module has no server coupling — the fields are exactly the public
// InstaPint payload documented on the route.
export type PintDropDTO = {
  id: string;
  handle: string;
  priceGbp: number | null;
  drink: string;
  passedDownNote: string;
  era: string;
  provenance: Provenance;
  venueId: string;
  createdAt: string;
  vibeTags?: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  // Server-resolved pub name + "open on the map" link (PRD §9). The GET route
  // enriches every drop from the venue index so a card never has to surface the
  // raw content-hashed `venue-…` id. Optional so an unenriched/legacy payload
  // (or a demo seed for an id the dataset no longer carries) still normalises.
  venueName?: string;
  venueMapUrl?: string;
  /** Approved owned avatar serve path for linked handles only. */
  avatarUrl?: string;
  optimistic?: OptimisticSpillState;
  /**
   * Optional Last Train context captured when the Spill was posted (Wave F0).
   * When both fields are present and the decision is a live kind, the feed card
   * may stamp an honest "before/after the last train" badge. Absent on most
   * drops — never invent these client-side.
   */
  leaveByIso?: string | null;
  lastTrainDecision?: LastPintDecisionKind | null;
};

export type OptimisticSpillState = {
  state: "pending" | "uploading" | "failed";
  message: string;
  uploadProgress: number | null;
  canRetry: boolean;
  clientRequestId: string;
};

// A normalized feed item. `type` is a lane discriminant so the surface can grow
// beyond raw pint drops (crawl stories, cheap-pint highlights) without the card
// needing to know which lane produced it. Every lane resolves to this one shape.
export type FeedItemType = "pint_drop" | "crawl_story" | "cheap_pint" | "check_in";

export type FeedItem = {
  type: FeedItemType;
  id: string;
  createdAt: string;
  handle: string;
  venueId: string;
  /** Approved owned avatar serve path for linked handles only. */
  avatarUrl?: string;
  // The human pub name, server-resolved from venueId (PRD §9). A friendly
  // fallback ("A London pub") when the id is unresolved — the card NEVER renders
  // the raw `venue-…` id.
  venueName: string;
  // "/map?sel=…" — tapping the venue opens the map with this pub selected.
  venueMapUrl: string;
  // Non-null photo URLs only, pint photo first (the hero of an InstaPint card),
  // then the venue selfie. Empty when a drop is text-only → card renders a
  // typographic "receipt" instead.
  photoUrls: string[];
  caption: string;
  priceGbp: number | null;
  vibeTags: string[];
  provenance: Provenance;
  drink: string;
  era: string;
  optimistic?: OptimisticSpillState;
  /** Optional Last Train leave-by ISO from the drop DTO (Wave F0). */
  leaveByIso?: string | null;
  /** Optional Last Pint decision kind from the drop DTO (Wave F0). */
  lastTrainDecision?: LastPintDecisionKind | null;
  /**
   * Area-level location label for a `check_in` item ("Shoreditch", "Brixton") —
   * the night-area name, never a coordinate. Present only on check-in items; the
   * card renders it as the "we're out" location.
   */
  areaName?: string;
};

// The friendly label shown when an id has no resolvable pub name — kept here so
// the server route, the normalizer, and any test agree on one string.
export const VENUE_FALLBACK_LABEL = "A London pub";

function normalizeOptimistic(value: unknown): OptimisticSpillState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<OptimisticSpillState>;
  if (raw.state !== "pending" && raw.state !== "uploading" && raw.state !== "failed") {
    return undefined;
  }
  const message =
    typeof raw.message === "string" && raw.message.trim().length > 0
      ? raw.message
      : raw.state === "failed"
        ? "Spill failed to post."
        : "Posting Spill.";
  const uploadProgress =
    typeof raw.uploadProgress === "number" && Number.isFinite(raw.uploadProgress)
      ? Math.max(0, Math.min(100, raw.uploadProgress))
      : null;
  return {
    state: raw.state,
    message,
    uploadProgress,
    canRetry: raw.canRetry === true,
    clientRequestId:
      typeof raw.clientRequestId === "string" && raw.clientRequestId.length > 0
        ? raw.clientRequestId
        : "",
  };
}

/**
 * Normalise one public Pint Drop DTO into a FeedItem. Collects the non-null
 * photo URLs (pint first, then venue) into `photoUrls`, coerces the optional
 * vibeTags to an array, and folds the drink + passed-down note into a caption.
 * Pure — never trusts field presence beyond the documented DTO shape.
 */
export function normalizePintDrop(dto: PintDropDTO): FeedItem {
  const photoUrls = [dto.pintPhotoUrl, dto.venuePhotoUrl].filter(
    (url): url is string => typeof url === "string" && url.length > 0,
  );
  // Prefer the server-resolved name; fall back to the friendly label so the raw
  // venue id is never surfaced. The link prefers the server's venueMapUrl but is
  // reconstructable from the id for older payloads.
  const venueName =
    typeof dto.venueName === "string" && dto.venueName.trim().length > 0
      ? dto.venueName
      : VENUE_FALLBACK_LABEL;
  const venueMapUrl =
    typeof dto.venueMapUrl === "string" && dto.venueMapUrl.length > 0
      ? dto.venueMapUrl
      : buildVenueMapUrl(dto.venueId);
  const item: FeedItem = {
    type: "pint_drop",
    id: dto.id,
    createdAt: dto.createdAt,
    handle: dto.handle,
    venueId: dto.venueId,
    venueName,
    venueMapUrl,
    photoUrls,
    caption: dto.passedDownNote ?? "",
    priceGbp: dto.priceGbp ?? null,
    vibeTags: Array.isArray(dto.vibeTags) ? dto.vibeTags : [],
    provenance: dto.provenance,
    drink: dto.drink ?? "",
    era: dto.era ?? "",
  };
  if (dto.leaveByIso != null && dto.leaveByIso !== "") {
    item.leaveByIso = dto.leaveByIso;
  }
  if (isLiveLastTrainDecision(dto.lastTrainDecision)) {
    item.lastTrainDecision = dto.lastTrainDecision;
  }
  const optimistic = normalizeOptimistic(dto.optimistic);
  if (optimistic) item.optimistic = optimistic;
  if (dto.avatarUrl) item.avatarUrl = dto.avatarUrl;
  return item;
}

/**
 * Normalise a "we're out" check-in (lib/checkIn.ts CheckIn, as read from
 * /api/check-ins) into a FeedItem so it merges into the same chronological feed
 * as pint drops. Area-LEVEL only: `areaName` is the night-area label (never a
 * coordinate), and the raw `venue-…` id is never surfaced as a name (there is no
 * client venue index here — a tagged venue still sets `venueId` for the map link
 * but the card leads with the area). Pure.
 */
export function normalizeCheckIn(checkIn: CheckIn): FeedItem {
  // No area is a valid, first-class case (a plain "out tonight" signal) — it
  // must never fall back to a place name (e.g. "London") that the author never
  // named. `areaName` stays undefined; the card renders "is out" with no
  // "in <area>" clause.
  const areaName = checkIn.areaSlug ? getNightArea(checkIn.areaSlug)?.name : undefined;
  const item: FeedItem = {
    type: "check_in",
    id: checkIn.id,
    createdAt: checkIn.createdAt,
    handle: normalizeHandle(checkIn.handle),
    venueId: checkIn.venueId ?? "",
    // A check-in's "venue" line is its area; the map link opens the tagged venue
    // when one exists, otherwise it is unused (the card links to the area).
    venueName: areaName ?? "",
    venueMapUrl: checkIn.venueId ? buildVenueMapUrl(checkIn.venueId) : "",
    photoUrls: [],
    caption: checkIn.note ?? "",
    priceGbp: null,
    vibeTags: [],
    provenance: "contributor",
    drink: "",
    era: "",
    areaName,
  };
  if (checkIn.avatarUrl) item.avatarUrl = checkIn.avatarUrl;
  return item;
}

// ── Filters ──────────────────────────────────────────────────────────────────

export type FeedFilter =
  | "latest"
  | "for-you"
  | "tonight"
  | "friends"
  | "nearby"
  | "cheap"
  | "crawls"
  | "golden-days";

export type FeedFilterDef = {
  id: FeedFilter;
  label: string;
  // Whether the filter is backed by real data signals or is a best-effort demo
  // lane. Surfaced honestly so the UI never implies a capability it lacks.
  demo: boolean;
};

// Order matters — this is the on-screen chip order.
// Wave I1: demo lanes `nearby` / `crawls` stay in the FeedFilter union +
// applyFeedFilter (pass-through) but are hidden from chips until real geo /
// crawl-linkage signals exist — they looked like product lanes and weren't.
// Cycle 15 (spec #393): `friends` is NO LONGER a chip. The Social Loop tabs
// (Your lot / Nearby / London) own the social axis now, and "Your lot" is the
// friends lane — a "Friends" chip beside those tabs was a duplicate taxonomy.
// The `friends` FeedFilter + applyFeedFilter branch stay (the "Your lot" tab
// composes over them internally); only the chip is gone.
export const FEED_FILTERS: FeedFilterDef[] = [
  { id: "latest", label: "Latest", demo: false },
  // This lane keeps the same public set and ranks stronger recent contributions
  // first. Name that behaviour instead of implying the viewer owns the rows.
  // The id stays "for-you" because it is a stored filter key, not visible copy.
  { id: "for-you", label: "Top picks", demo: false },
  { id: "tonight", label: "Tonight", demo: false },
  // Label "Cheap pints", not "Cheap Legends": the long label clipped mid-word
  // at the 390px strip edge (judge-w2 polish 2) and the voice spec's own
  // register says the thing plainly. The id stays "cheap" — stored filter key.
  { id: "cheap", label: "Cheap pints", demo: false },
  { id: "golden-days", label: "Golden Days", demo: false },
];

const CHEAP_MAX_GBP = 5.5;
const TONIGHT_WINDOW_MS = DAY_MS;

function createdMs(item: FeedItem): number {
  const t = Date.parse(item.createdAt);
  return Number.isFinite(t) ? t : 0;
}

// Optional context for filters that need a signal beyond the per-drop payload.
// Today only `friends` reads it (the viewer's following set); kept as an object
// so more lanes can add their own signal without changing the call signature.
export type FeedFilterContext = {
  // Normalized handles the viewer follows. Drives the `friends` lane: only drops
  // authored by a handle in this set survive. Undefined/empty ⇒ friends is empty
  // (the page shows a "follow people" state) rather than leaking the whole feed.
  followingHandles?: Set<string>;
  // Signal for the `for-you` lane (issue #36 / Wave G4) — the deterministic
  // ranking inputs (now, reaction counts, story-pub venue ids, followingHandles).
  // Undefined ⇒ For You degrades to a recency-only ranking with `now` taken at
  // call time, so the lane still works before reaction summaries have loaded.
  // When forYou.followingHandles is omitted, applyFeedFilter falls back to
  // ctx.followingHandles so Friends and For You share one follow set. See
  // lib/forYou.ts.
  forYou?: ForYouContext;
};

/**
 * Apply a feed filter as a pure transform over already-normalised items.
 *
 * Real filters (backed by data on every drop):
 *  - `tonight`     — drops created in the last 24h (by createdAt).
 *  - `cheap`       — priced <= £5.50, sorted by price ascending (cheapest first).
 *  - `golden-days` — anecdote/heritage drops carrying an `era` (passed-down
 *                    memories), newest-first — the nostalgia lane.
 *  - `friends`     — drops authored by a handle in `ctx.followingHandles`
 *                    (the viewer's follow graph), newest-first. With no set (or
 *                    an empty one) the lane is empty by design, so the page can
 *                    prompt the viewer to follow people rather than show all.
 *  - `for-you`     — the SAME visible set, re-ordered by a deterministic
 *                    recency×quality score (lib/forYou.ts). Never removes drops;
 *                    a pure client-side re-rank over server-provided items.
 *
 * Demo-only filters (no per-drop signal in the public payload; best-effort so
 * the lane isn't empty in the prototype — documented as demo in FEED_FILTERS):
 *  - `nearby`      — no geolocation on the client feed; returns the full set.
 *  - `crawls`      — no per-drop crawl linkage yet; returns the full set.
 */
export function applyFeedFilter(
  items: FeedItem[],
  filter: FeedFilter,
  ctx?: FeedFilterContext,
): FeedItem[] {
  switch (filter) {
    case "latest":
      // The default lane: every visible drop, newest first. Always has content
      // (unlike `tonight`, which is empty when nothing was logged in 24h), so a
      // first-time visitor never lands on an empty feed.
      return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "for-you": {
      // The For-You lane (issue #36 / Wave G4): the SAME visible set, re-ordered
      // by a deterministic recency×quality score (lib/forYou.ts) — no new API,
      // no ML, no drops removed. With no forYou context (summaries not loaded
      // yet) we still rank on recency alone, taking `now` at call time so the
      // lane is never empty. Friends boost (G4) reuses the same following set
      // as the Friends lane when the caller hasn't put it on forYou yet.
      const forYouCtx: ForYouContext = {
        ...(ctx?.forYou ?? { now: Date.now() }),
        followingHandles:
          ctx?.forYou?.followingHandles ?? ctx?.followingHandles,
      };
      return rankForYou(items, forYouCtx);
    }
    case "cheap":
      return items
        .filter((i) => typeof i.priceGbp === "number" && i.priceGbp <= CHEAP_MAX_GBP)
        .sort((a, b) => (a.priceGbp as number) - (b.priceGbp as number));
    case "tonight": {
      const now = Date.now();
      return items.filter((i) => now - createdMs(i) <= TONIGHT_WINDOW_MS);
    }
    case "golden-days":
      return items
        .filter((i) => i.era.trim().length > 0 || i.provenance === "anecdote")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "friends": {
      // No follow set (viewer anonymous / follows nobody) ⇒ an empty lane, on
      // purpose: the page renders a "follow people" prompt instead of the feed.
      const following = ctx?.followingHandles;
      if (!following || following.size === 0) return [];
      return items
        .filter((i) => following.has(normalizeHandle(i.handle)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    case "nearby":
    case "crawls":
    default:
      // Demo lanes: no per-drop signal — pass the set through untouched.
      return items;
  }
}

// ── Bar-Tab composition (issue #36) ───────────────────────────────────────────

// One entry in a venue's Bar-Tab grid — an IG-profile-style tile. A `photo`
// tile leads with its hero image; a `receipt` tile is a mini typographic card
// for a text-only drop, so the grid is never a gap. Both link to /p/[id].
export type BarTabTile = {
  id: string;
  kind: "photo" | "receipt";
  photoUrl: string | null;
  priceGbp: number | null;
  drink: string;
  handle: string;
  note: string;
  createdAt: string;
};

export type BarTab = {
  tileCount: number;
  photoCount: number;
  // Cheapest price across the visible drops (for the venue header stamp), or
  // null when no visible drop carries a price.
  cheapestGbp: number | null;
  tiles: BarTabTile[];
};

/**
 * Compose a venue's Bar-Tab grid from ALREADY-VISIBILITY-FILTERED FeedItems
 * (the caller passes the output of the store's `listVisible(venueId)`, so the
 * #29 visibility guarantees — no friends/legacy leak, anonymous shows the safe
 * label — hold by construction; this function adds NO drops the caller didn't
 * hand it). Newest-first, photo tiles + receipt tiles for text-only drops. Pure.
 */
export function buildBarTab(items: FeedItem[]): BarTab {
  const ordered = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tiles: BarTabTile[] = ordered.map((item) => {
    const photoUrl = item.photoUrls[0] ?? null;
    return {
      id: item.id,
      kind: photoUrl ? "photo" : "receipt",
      photoUrl,
      priceGbp: item.priceGbp,
      drink: item.drink,
      handle: item.handle,
      note: item.caption,
      createdAt: item.createdAt,
    };
  });
  const prices = ordered
    .map((i) => i.priceGbp)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);
  const cheapestGbp = prices.length ? Math.min(...prices) : null;
  return {
    tileCount: tiles.length,
    photoCount: tiles.filter((t) => t.kind === "photo").length,
    cheapestGbp,
    tiles,
  };
}

// ── Cursor pagination ─────────────────────────────────────────────────────────

// A cursor is the "createdAt|id" of the last item on a page — NOT an offset, so
// it is stable as newer items are prepended (an offset would skip/duplicate).
export type FeedPage = { items: FeedItem[]; nextCursor: string | null };

export function cursorOf(item: FeedItem): string {
  return `${item.createdAt}|${item.id}`;
}

/**
 * Cursor-paginate `items`. With no cursor, returns the first `limit`. With a
 * cursor, returns the `limit` items that follow the item whose cursor matches
 * (the cursor item itself is excluded). `nextCursor` is the cursor of the last
 * returned item, or null when the page reaches the end of the list. Pure.
 */
export function paginate(
  items: FeedItem[],
  cursor?: string | null,
  limit = 12,
): FeedPage {
  let start = 0;
  if (cursor) {
    const idx = items.findIndex((i) => cursorOf(i) === cursor);
    // Unknown cursor → start from the top rather than throwing; a stale cursor
    // should degrade to "first page", never crash the feed.
    start = idx === -1 ? 0 : idx + 1;
  }
  const page = items.slice(start, start + limit);
  const last = page[page.length - 1];
  const reachedEnd = start + page.length >= items.length;
  const nextCursor = last && !reachedEnd ? cursorOf(last) : null;
  return { items: page, nextCursor };
}

/**
 * Defensive filter for feed aggregation: keep only items whose ids survived a
 * server-side visibility gate (filterPubliclyReadableDropIds /
 * canViewOnPublicSurface). Pure — the caller passes the permitted id set.
 */
export function filterFeedItemsToPermittedIds(
  items: FeedItem[],
  permittedIds: ReadonlySet<string>,
): FeedItem[] {
  if (permittedIds.size === 0) return [];
  return items.filter((item) => permittedIds.has(item.id));
}
