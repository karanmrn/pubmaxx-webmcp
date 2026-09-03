import type { OutOpenPlan } from "@/lib/out";
import { getNightArea } from "@/lib/nightAreas";
import { isNightAreaSlug } from "@/lib/nightPlanning";
import {
  outSourceAttribution,
  outSourceAttributionFromLabels,
  type OutSourceCredit,
} from "@/lib/out/attribution";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import { OUT_UNMATCHED_PLACES_SHOWN } from "@/lib/out/types";
import type { OutVenueMatchStatus } from "@/lib/out/venueMatch";
import { outWindowNoun, type OutDayWindow } from "@/lib/outListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

/** One listed Open Crew is enough to make discovery useful at London MVP. */
export const OUT_OPEN_PLANS_MIN_SENDABLE = 1;

export const OUT_LISTING_PUB_ABSENT_LINE =
  "No matching pub in PUBMAXX yet.";

export { OUT_UNMATCHED_PLACES_SHOWN } from "@/lib/out/types";

export { canonicalOutVenueId } from "@/lib/out/venueId";

export type OutListingGroupKind = "venue" | "area" | "place";

export type OutListingGroup = {
  key: string;
  kind: OutListingGroupKind;
  label: string;
  rows: WhatsOnRow[];
};

export type OutListingPubPair =
  | {
      status: "matched";
      placeName: string;
      mapHref: string;
    }
  | {
      status: "absent";
      line: typeof OUT_LISTING_PUB_ABSENT_LINE;
    };

function normalizePlaceName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function hasResolvedPub(row: WhatsOnRow): boolean {
  return canonicalOutVenueId(row.venueId) !== null;
}

function areaGroupLabel(area: string): string {
  if (isNightAreaSlug(area)) return getNightArea(area).name;
  return area
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The desktop group key prefers a resolved pub, then a night area, then the place name. */
export function outListingGroupKey(row: WhatsOnRow): {
  key: string;
  kind: OutListingGroupKind;
  label: string;
} {
  const venueId = canonicalOutVenueId(row.venueId);
  if (venueId) {
    return {
      key: `venue:${venueId}`,
      kind: "venue",
      label: row.placeName.trim() || venueId,
    };
  }
  if (typeof row.area === "string" && row.area.trim().length > 0) {
    const area = row.area.trim();
    return {
      key: `area:${area}`,
      kind: "area",
      label: areaGroupLabel(area),
    };
  }
  const place = normalizePlaceName(row.placeName);
  return {
    key: `place:${place}`,
    kind: "place",
    label: row.placeName.trim() || "Listing",
  };
}

function rowSortTime(row: WhatsOnRow): number {
  if (row.startsAt && Number.isFinite(Date.parse(row.startsAt))) {
    return Date.parse(row.startsAt);
  }
  if (row.startsDate && Number.isFinite(Date.parse(`${row.startsDate}T12:00:00.000Z`))) {
    return Date.parse(`${row.startsDate}T12:00:00.000Z`);
  }
  return Number.POSITIVE_INFINITY;
}

/** Desktop /out groups only listings that can open a PUBMAXX venue. */
export function groupOutListings(rows: readonly WhatsOnRow[]): OutListingGroup[] {
  const byKey = new Map<string, OutListingGroup>();
  for (const row of rows) {
    if (!hasResolvedPub(row)) continue;
    const descriptor = outListingGroupKey(row);
    const existing = byKey.get(descriptor.key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    byKey.set(descriptor.key, {
      key: descriptor.key,
      kind: descriptor.kind,
      label: descriptor.label,
      rows: [row],
    });
  }
  const groups = [...byKey.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((left, right) => rowSortTime(left) - rowSortTime(right)),
  }));
  return groups.sort((left, right) => {
    const leftTime = Math.min(...left.rows.map(rowSortTime));
    const rightTime = Math.min(...right.rows.map(rowSortTime));
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.label.localeCompare(right.label, "en-GB");
  });
}

/** Single reader-facing label for the resolved venue badge on /out listings. */
export const OUT_LISTING_VENUE_BADGE_LABEL = "PUBMAXX venue";

/** The pub beside a gig is the resolved venue on the row, or an honest absence. */
export function outListingPubPair(row: WhatsOnRow): OutListingPubPair {
  const venueId = canonicalOutVenueId(row.venueId);
  if (venueId) {
    return {
      status: "matched",
      placeName: row.placeName.trim() || venueId,
      mapHref: `/map?sel=${encodeURIComponent(venueId)}`,
    };
  }
  return { status: "absent", line: OUT_LISTING_PUB_ABSENT_LINE };
}

/** The page announces unmatched event listings once, not beside every row. */
export function outListingUnmatchedCount(rows: readonly WhatsOnRow[]): number {
  return rows.reduce(
    (count, row) =>
      hasResolvedPub(row) ? count : count + 1,
    0,
  );
}

export type OutUnmatchedNotice = {
  /** The count, and which night it is about. */
  line: string;
  /** Provider place names, or empty beside useful matched Venue cards. */
  places: string;
  /** Who listed the hidden rows. Credit is owed whether or not a card shows. */
  credits: OutSourceCredit[];
  /** The one way onward. */
  way: { href: string; label: string };
};

export type OutUnmatchedListingsNoticeOptions = {
  unmatchedCount?: number;
  unmatchedPlaces?: readonly string[];
  unmatchedPlaceCount?: number;
  unmatchedSources?: readonly string[];
};

function joinPlaces(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What the page says about the listings it is NOT showing.
 *
 * Every unmatched row is dropped from the pub list (groupOutListings), so
 * without this line an Out with four Ticketmaster rows at four arenas read as
 * an empty city under one word, "Some". The rule: say how many, credit who
 * listed them, and hand the reader somewhere to go. Name the hidden places
 * only when no matched card is available. The count is about the HIDDEN rows
 * alone, so with cards on screen it says "more".
 *
 * A match that could not RUN is a different finding from a place that is not
 * listed: the slim index failed to read, and the same four rows may well be at
 * pubs we list. That answer keeps the count and the names and drops the claim.
 *
 * Silent when nothing was hidden: with every row on a listed pub there is
 * nothing to say, and with no rows at all the status lines own the sentence.
 */
export function outUnmatchedListingsNotice(
  rows: readonly WhatsOnRow[],
  window: OutDayWindow,
  venueMatch: OutVenueMatchStatus | undefined,
  options: OutUnmatchedListingsNoticeOptions = {},
): OutUnmatchedNotice | null {
  const hidden = rows.filter((row) => !hasResolvedPub(row));
  const count = options.unmatchedCount ?? hidden.length;
  if (count === 0) return null;
  const shown = rows.length - hidden.length;
  const noun = outWindowNoun(window);
  // "at the weekend" reads as a phrase; "tonight" and "tomorrow" stand alone.
  const when = window === "weekend" ? `at ${noun}` : noun;

  let line: string;
  if (venueMatch !== "ready") {
    line = `We couldn't check which of ${noun === "the weekend" ? "the weekend's" : `${noun}'s`} ${count} ${
      count === 1 ? "listing is" : "listings are"
    } at a pub we list.`;
  } else if (count === 1) {
    line = `1 ${shown > 0 ? "more " : ""}listing ${when} is at a place we don't list yet.`;
  } else {
    line = `${count} ${shown > 0 ? "more " : ""}listings ${when} are at places we don't list yet.`;
  }

  const names = options.unmatchedPlaces ? [...options.unmatchedPlaces] : (() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const row of hidden) {
      const name = row.placeName.trim();
      const key = normalizePlaceName(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    return names;
  })();
  const rest = names.length - OUT_UNMATCHED_PLACES_SHOWN;
  const named = names.slice(0, OUT_UNMATCHED_PLACES_SHOWN);
  const extraPlaceCount =
    options.unmatchedPlaceCount === undefined
      ? rest
      : Math.max(0, options.unmatchedPlaceCount - named.length);
  const places =
    venueMatch === "ready" && shown > 0
      ? ""
      : named.length === 0
      ? ""
      : extraPlaceCount > 0
        ? `${named.join(", ")} and ${extraPlaceCount} more ${extraPlaceCount === 1 ? "place" : "places"}.`
        : `${joinPlaces(named)}.`;

  const way =
    window === "tonight"
      ? { href: "/tonight", label: "See what else is on tonight" }
      : { href: "/map", label: "Find a pub on the map" };

  const credits =
    options.unmatchedSources === undefined
      ? outSourceAttribution(hidden)
      : outSourceAttributionFromLabels(options.unmatchedSources);
  return { line, places, credits, way };
}

/** A sendable open plan carries a resolved meeting point the card can render. */
export function sendableOpenPlans(plans: readonly OutOpenPlan[]): OutOpenPlan[] {
  return plans.filter((plan) => plan.meetingPoint !== null);
}

/** Hide the whole section rather than show an empty card when the market is thin. */
export function outOpenPlansSectionVisible(plans: readonly OutOpenPlan[]): boolean {
  return sendableOpenPlans(plans).length >= OUT_OPEN_PLANS_MIN_SENDABLE;
}
