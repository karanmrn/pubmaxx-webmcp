// The recap view model — the morning-after memory of a night, composed from
// ONLY what is real. Every section is gated: it renders solely when its data
// exists, exactly like the digest. Nothing is invented. Photos and identities
// pass through the existing Night Story consent flow before they ever reach a
// public surface - see selectPublishedRecapMoments.
//
// This module is pure (no window, no Date.now, no fetch). Two adapters feed one
// RecapView shape:
//   • composeRecapFromCompletion   — the PRIVATE crew recap (share-safe Plan
//                                    completion data; no photos, no identities).
//   • composeRecapFromPublishedStory — the PUBLIC shared recap (published +
//                                    consent-approved Night Story moments only).

import { lastTrainBadge } from "@/lib/lastTrainBadge";
import type { LastPintDecisionKind } from "@/lib/tfl";
import type { NightMoment, PublicNightStory } from "@/lib/nightMemory";
import type { PintDrop } from "@/lib/pintDropShared";
import type { CrawlEnding, EndingSelection } from "@/lib/plan";
import { formatGbp } from "@/lib/formatGbp";

export type RecapRouteStop = {
  position: number;
  venueId: string;
  venueName: string;
  caption: string | null;
};

export type RecapPint = {
  venueId: string | null;
  venueName: string | null;
  drink: string | null;
  /** The logged price in pounds, or null for a note-only pint. Source of truth. */
  priceGbp: number | null;
  /** Display string derived from priceGbp — never parsed back into a number. */
  priceLabel: string | null;
  note: string | null;
};

/** A photo is only ever referenced by its Storage key — never bytes, never a face. */
export type RecapPhoto = {
  id: string;
  caption: string | null;
  venueId: string | null;
  mediaObjectKey: string;
};

export type RecapEndingView = { kind: CrawlEnding; label: string };
export type RecapGuardianView = { label: string; tone: "safe" | "risk" };

export type RecapStats = {
  stopCount: number;
  pintCount: number;
  totalGbp: number | null;
  cheapestPintGbp: number | null;
};

export type RecapView = {
  title: string;
  completedAt: string | null;
  /** Renders only when length >= 1. */
  route: RecapRouteStop[];
  /** Renders only when length >= 1. */
  pints: RecapPint[];
  /** Renders only when length >= 1. Public surfaces receive consent-approved photos only. */
  photos: RecapPhoto[];
  ending: RecapEndingView | null;
  guardian: RecapGuardianView | null;
  closingLine: string;
  stats: RecapStats;
};

export { formatGbp } from "@/lib/formatGbp";

function trimmed(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

/** The chosen ending, rendered from persisted evidence — never a guess. */
export function endingView(
  ending: CrawlEnding | null | undefined,
  selection: EndingSelection | null | undefined,
): RecapEndingView | null {
  if (ending !== "food" && ending !== "get_home" && ending !== "keep_going") return null;
  const evidenceLabel = trimmed(selection?.evidenceSnapshot?.label);
  const fallback: Record<CrawlEnding, string> = {
    food: "Ended on food",
    get_home: "Everyone headed home",
    keep_going: "Kept the night going",
  };
  return { kind: ending, label: evidenceLabel ?? fallback[ending] };
}

/**
 * The guardian save, if one honestly happened. Only surfaces on a `get_home`
 * ending backed by a LIVE last-train verdict — the badge itself refuses to
 * claim a train was caught, so this never invents "made the 23:42". It reports
 * the timestamp relationship the app actually observed.
 */
export function guardianView(input: {
  ending: CrawlEnding | null | undefined;
  dropCreatedAt?: string | null;
  leaveByIso?: string | null;
  decision?: LastPintDecisionKind | null;
}): RecapGuardianView | null {
  if (input.ending !== "get_home") return null;
  const badge = lastTrainBadge(input.dropCreatedAt, input.leaveByIso, input.decision);
  if (!badge) return null;
  const label = badge.tone === "safe" ? "Home before the last train" : "Out past the last train";
  return { label, tone: badge.tone };
}

/** A factual closing line derived only from what the recap already knows. */
export function dryLondonClosingLine(view: {
  ending: RecapEndingView | null;
  guardian: RecapGuardianView | null;
  stats: RecapStats;
}): string {
  if (view.guardian) {
    return view.guardian.tone === "safe"
      ? "The night ended before the last train."
      : "The night continued after the last train.";
  }
  if (view.ending?.kind === "food") {
    return "Ended with food.";
  }
  if (view.ending?.kind === "keep_going") {
    return "The night continued after this route ended.";
  }
  if (view.stats.stopCount >= 4) {
    return "Route complete.";
  }
  return "Night complete.";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function statsFor(route: RecapRouteStop[], pints: RecapPint[]): RecapStats {
  // Every derived figure comes off the numeric priceGbp — never a parsed label.
  let total: number | null = null;
  let cheapest: number | null = null;
  for (const pint of pints) {
    if (typeof pint.priceGbp !== "number" || !Number.isFinite(pint.priceGbp)) continue;
    total = (total ?? 0) + pint.priceGbp;
    cheapest = cheapest === null ? pint.priceGbp : Math.min(cheapest, pint.priceGbp);
  }
  return {
    stopCount: route.length,
    pintCount: pints.length,
    totalGbp: total === null ? null : round2(total),
    cheapestPintGbp: cheapest === null ? null : round2(cheapest),
  };
}

/** The PRIVATE crew recap: share-safe completion data. No photos, no identities. */
export function composeRecapFromCompletion(input: {
  title: string;
  completedAt: string | null;
  ending: CrawlEnding | null | undefined;
  endingSelection?: EndingSelection | null;
  stops: Array<{ venueId: string; venueName: string; position: number; caption?: string | null }>;
  pints?: RecapPint[];
  lastTrain?: { dropCreatedAt?: string | null; leaveByIso?: string | null; decision?: LastPintDecisionKind | null } | null;
}): RecapView {
  const route = input.stops
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((stop, position) => ({
      position,
      venueId: stop.venueId,
      venueName: stop.venueName,
      caption: trimmed(stop.caption),
    }));
  const pints = (input.pints ?? []).filter((pint) => pint.priceLabel !== null || pint.note !== null || pint.drink !== null);
  const ending = endingView(input.ending, input.endingSelection);
  const guardian = guardianView({ ending: input.ending, ...(input.lastTrain ?? {}) });
  const stats = statsFor(route, pints);
  return {
    title: trimmed(input.title) ?? "Tonight's Memory",
    completedAt: input.completedAt ?? null,
    route,
    pints,
    photos: [],
    ending,
    guardian,
    closingLine: dryLondonClosingLine({ ending, guardian, stats }),
    stats,
  };
}

/**
 * Public consent gate: the Story is PUBLISHED, not private, and the
 * moment is in the published allowlist. This mirrors the store's own disclosure
 * predicate — publishedMomentIds is only ever set from consent-approved moments,
 * and a later withdrawal removes the id — so a moment leaks to no public surface
 * unless it clears both. Anything else is dropped.
 */
export function selectPublishedRecapMoments(moments: NightMoment[], story: PublicNightStory): NightMoment[] {
  if (story.status !== "published" || story.visibility === "private") return [];
  const allow = new Set(story.publishedMomentIds);
  return moments.filter((moment) => allow.has(moment.id));
}

/** The PUBLIC shared recap: composed strictly from published + approved moments. */
export function composeRecapFromPublishedStory(input: {
  story: PublicNightStory;
  moments: NightMoment[];
  pintDropsById?: Map<string, PintDrop>;
  venueNames?: Map<string, string>;
}): RecapView | null {
  if (input.story.status !== "published" || input.story.visibility === "private") return null;
  const published = selectPublishedRecapMoments(input.moments, input.story);
  const venueName = (venueId: string | null): string | null =>
    venueId ? input.venueNames?.get(venueId) ?? null : null;

  const route: RecapRouteStop[] = published
    .filter((moment) => moment.kind === "venue" && moment.venueId)
    .sort((left, right) => (left.occurredAt ?? left.createdAt).localeCompare(right.occurredAt ?? right.createdAt))
    .map((moment, position) => ({
      position,
      venueId: moment.venueId as string,
      venueName: venueName(moment.venueId) ?? "A pub",
      caption: trimmed(moment.caption),
    }));

  const pints: RecapPint[] = published
    .filter((moment) => moment.kind === "pint_drop")
    .map((moment) => {
      const drop = input.pintDropsById?.get(moment.pintDropId as string) ?? null;
      const price = drop && typeof drop.priceGbp === "number" ? drop.priceGbp : null;
      return {
        venueId: moment.venueId ?? drop?.venueId ?? null,
        venueName: venueName(moment.venueId ?? drop?.venueId ?? null),
        drink: trimmed(drop?.drink),
        priceGbp: price,
        priceLabel: price === null ? null : formatGbp(price),
        note: trimmed(moment.caption) ?? trimmed(drop?.passedDownNote),
      };
    });

  const photos: RecapPhoto[] = selectApprovedRecapPhotosFromPublished(published).map((moment) => ({
    id: moment.id,
    caption: trimmed(moment.caption),
    venueId: moment.venueId,
    mediaObjectKey: moment.mediaObjectKey as string,
  }));

  const stats = statsFor(route, pints);
  return {
    title: trimmed(input.story.title) ?? "A night out",
    completedAt: input.story.publishedAt ?? null,
    route,
    pints,
    photos,
    ending: null,
    guardian: null,
    closingLine: dryLondonClosingLine({ ending: null, guardian: null, stats }),
    stats,
  };
}

function selectApprovedRecapPhotosFromPublished(published: NightMoment[]): NightMoment[] {
  return published.filter(
    (moment) => moment.kind === "photo" && typeof moment.mediaObjectKey === "string" && moment.mediaObjectKey.length > 0,
  );
}

/**
 * WhatsApp-native recap share copy. Matches the pure-builder shape of
 * lib/shareArtifacts.ts (#314, branch feat/whatsapp-share-artifacts, unmerged
 * on main). REBASE-BY-INTENT: when #314 lands, fold this into shareArtifacts.ts
 * beside buildCrawlShareText (a recap is a completed crawl) and drop it here —
 * no call-site change, the signature is deliberately identical in spirit.
 */
export type RecapShareInput = { title: string; stopCount: number; totalGbp?: number | null };

export function buildRecapShareText(input: RecapShareInput): string {
  const title = input.title.trim() || "Our night out";
  const stops = Math.max(0, Math.floor(input.stopCount));
  const stopClause = stops > 0 ? `. ${stops} ${stops === 1 ? "stop" : "stops"}` : "";
  const spendClause =
    typeof input.totalGbp === "number" && input.totalGbp > 0 ? `, ${formatGbp(input.totalGbp)} across the night` : "";
  return `${title}${stopClause}${spendClause}. Night logged on PUBMAXX.`;
}
