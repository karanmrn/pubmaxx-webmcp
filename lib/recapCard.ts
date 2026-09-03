import { priceStamp } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";
import type { CrawlEnding } from "@/lib/plan";
import type {
  NightStory,
  NightStoryStatus,
  NightStoryVisibility,
  PublicNightStory,
} from "@/lib/nightMemory";

// ── Recap OG card: data-selection + privacy gate ─────────────────────────────
//
// This module is the ONLY place that decides whether a shared-recap OG image may
// carry night details. The gate is deliberately pure and synchronous so it can
// be unit-tested exhaustively without a render, a network call, or Supabase.
//
// Rule (Cycle 9, Lane 3): a recap earns the RICH card only when its NightStory
// is approved-shared — `status === "published"` AND `visibility !== "private"`
// (i.e. the value the public accessor `getNightStory(storyId, null)` only ever
// returns once the existing Story consent/approval flow has published it).
// Anything else — a private draft, an unlisted-but-unpublished story, a missing
// story, or a fetch failure resolved to `null` — collapses to the honest
// brand-generic FALLBACK card. The fallback never names a venue, a date, a stat,
// or a person. There is no in-between: privacy is a boolean, not a gradient.
//
// The card owner (opengraph-image.tsx) never fetches crew handles or joins the
// plan store itself. Every night detail arrives pre-cleared through `stats`,
// which a public-safe server composer produces; this module treats `stats` as
// untrusted at the boundary anyway (clamps text, floors counts, drops crew names
// past a cap) so a composer bug can never blow out the layout or leak an
// unbounded string onto a 1200×630 image.

/**
 * Public-safe, already-consent-gated recap facts the card renders. A value being
 * present here is a promise from the composer that it is safe to show publicly —
 * `crew` in particular must contain ONLY names the approval flow explicitly
 * marked public (handles for un-consented members must never reach this array).
 */
export type RecapCardStats = {
  /** Route stops walked on the night. */
  stopCount: number;
  /** Pints (or Pint Drops) logged across the night. */
  pintsLogged: number;
  /** Distinct boroughs the route crossed. */
  boroughsCrossed: number;
  /**
   * Which ending the night resolved to, or null when it cannot be sourced. The
   * public recap composer leaves this null (the ending lives on the plan
   * completion, which the public story does not join), so the card must render
   * without an ending rather than assume one.
   */
  ending: CrawlEnding | null;
  /** Cheapest logged pint in GBP, or null when there is no honest figure. */
  cheapestPintGbp: number | null;
  /** Display names cleared for public sharing (may be empty). */
  crew: string[];
  /** The night's date as an ISO string (typically the plan `completedAt`), or null. */
  nightDateIso?: string | null;
};

export type RecapCardSource = {
  /** The story as returned by `getNightStory(storyId, null)` — null when the gate must fail. */
  story: PublicNightStory | NightStory | null;
  /** Public-safe stats, or null when the composer has none (rich card degrades gracefully). */
  stats: RecapCardStats | null;
  /** The night's date (ISO string, typically the plan `completedAt`), or null. */
  nightDate: string | null;
};

export type RecapCardData =
  | {
      variant: "rich";
      title: string;
      dateLabel: string | null;
      /** Route stops, or null when unknown (route line hidden). */
      stopCount: number | null;
      pintsLogged: number | null;
      boroughsCrossed: number | null;
      /** Short ending label, or null when the ending cannot be sourced (tile hidden). */
      endingLabel: string | null;
      /** Pre-stamped price string (e.g. "£4.20"), or null (brass plaque hidden). */
      cheapestPint: string | null;
      /** Public-cleared crew names (may be empty — crew line hidden). */
      crew: string[];
    }
  | { variant: "fallback" };

// Short, legible-at-thumbnail ending labels (dry, no exclamation).
const ENDING_LABEL: Record<CrawlEnding, string> = {
  food: "Late food",
  get_home: "Got home",
  keep_going: "Kept going",
};

export function endingLabel(ending: CrawlEnding): string {
  return ENDING_LABEL[ending] ?? "Called it";
}

/** True only for a story the public accessor would only surface once approved-shared. */
export function isApprovedShared(
  story: { status: NightStoryStatus; visibility: NightStoryVisibility } | null | undefined,
): boolean {
  return !!story && story.status === "published" && story.visibility !== "private";
}

// Floor an untrusted count to a non-negative integer, or null when absent/insane.
function safeCount(value: number | null | undefined, max = 99): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < 0) return null;
  return n > max ? max : n;
}

// Format an ISO night date as a compact en-GB London date, or null.
export function formatNightDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/London",
    }).format(new Date(ts));
  } catch {
    return null;
  }
}

/**
 * The privacy gate. Returns the rich card ONLY for approved-shared recaps;
 * everything else — including missing stories and fetch failures — returns the
 * honest fallback. Never throws.
 */
export function selectRecapCardData(source: RecapCardSource): RecapCardData {
  const { story, stats, nightDate } = source;
  if (!isApprovedShared(story ?? null)) {
    return { variant: "fallback" };
  }
  // `story` is approved-shared here; `title` is safe to show.
  const title = clampOgText(story!.title, 64, "A night on PUBMAXX", {
    collapseWhitespace: true,
    collapseBeforeFilter: true,
  });
  const dateLabel = formatNightDate(nightDate);

  if (!stats) {
    // Approved, but no public stats composed yet — still an honest rich card
    // (title + date), just without the stat furniture.
    return {
      variant: "rich",
      title,
      dateLabel,
      stopCount: null,
      pintsLogged: null,
      boroughsCrossed: null,
      endingLabel: null,
      cheapestPint: null,
      crew: [],
    };
  }

  const crew = (Array.isArray(stats.crew) ? stats.crew : [])
    .map((name) =>
      clampOgText(name, 24, "", {
        collapseWhitespace: true,
        collapseBeforeFilter: true,
      }),
    )
    .filter((name) => name.length > 0)
    .slice(0, 4);

  return {
    variant: "rich",
    title,
    dateLabel,
    stopCount: safeCount(stats.stopCount, 20),
    pintsLogged: safeCount(stats.pintsLogged),
    boroughsCrossed: safeCount(stats.boroughsCrossed, 33),
    endingLabel: stats.ending ? endingLabel(stats.ending) : null,
    cheapestPint: priceStamp(stats.cheapestPintGbp),
    crew,
  };
}

// ── Cache headers ────────────────────────────────────────────────────────────
// Mirrors #330's OG cache-header pattern (unmerged at time of writing). When
// #330 lands its shared `OG_CACHE_HEADERS`, collapse these onto it — this is the
// dedupe note. Two profiles, because a recap card is privacy-sensitive:
//
//  • FALLBACK — brand-generic, carries no night data, safe to cache hard.
//  • RICH — carries approved night details. If a host revokes approval the card
//    must flip back to the fallback quickly, so it gets a short shared-cache TTL
//    with a longer stale-while-revalidate window (fast propagation, no thundering
//    origin load).
export const RECAP_OG_CACHE_HEADERS = {
  fallback: "public, s-maxage=86400, stale-while-revalidate=604800",
  rich: "public, s-maxage=60, stale-while-revalidate=600",
} as const;

export function recapOgCacheHeaders(variant: RecapCardData["variant"]): { "cache-control": string } {
  return { "cache-control": RECAP_OG_CACHE_HEADERS[variant] };
}
