// C3 — event-at-stop chip matching for the plan view. Pure logic: given
// tonight's What's-On rows and a plan's stops + start time, pick at most one
// honest, grounded "on tonight" chip per stop venue. Reuses the same
// hero-kind priority and label vocabulary as the venue-sheet W1 badges
// (lib/whatsOnBadges) so the idiom matches across the app. Never invents —
// a stop with no matching row gets no chip, and a plan that isn't for
// tonight gets no chips at all (the /api/whats-on spine only ever carries
// tonight's rows, so a plan for another evening cannot honestly badge from it).

import {
  isOnTonight,
  londonServiceDayBounds,
  tonightServiceWindow,
  whatsOnBarePriceGbp,
  type WhatsOnConfidence,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import { laneTimeLabel, WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";

export type StopEventChip = {
  venueId: string;
  kind: WhatsOnKind;
  /** e.g. "Quiz night · 8:00 pm", "Screens live sport", "Deal on · 9:00 pm · £4.00" */
  label: string;
  timeLabel: string | null;
  sourceLabel: string;
  sourceUrl: string;
  confidence: WhatsOnConfidence;
  observedAt: string;
};

/**
 * Is the plan's own start time inside the CURRENT tonight window? /api/whats-on
 * only ever carries rows for tonight, so a plan scheduled for another evening
 * must never grow event chips built from tonight's data — that would silently
 * misattribute a real row to the wrong night.
 */
export function planStartsThisTonight(planStartTimeIso: string, now: number = Date.now()): boolean {
  const startMs = Date.parse(planStartTimeIso);
  if (!Number.isFinite(startMs)) return false;
  const { start, end } = londonServiceDayBounds(now);
  return startMs >= Date.parse(start) && startMs < Date.parse(end);
}

/**
 * Is a tonight row still relevant to a crew arriving at (or before) the plan's
 * start time? Timed kinds (quiz/deal/music) stay relevant while they are still
 * running — `endsAt` when the row carries one, otherwise `startsAt` — so a
 * quiz that already finished before the group's first pint does not badge the
 * stop. Sport is an untimed "screens live sport" attribute (see
 * WHATS_ON_KIND_META), so it is always relevant within the tonight window.
 */
export function isEventRelevantToPlanStart(row: WhatsOnRow, planStartMs: number): boolean {
  if (!WHATS_ON_KIND_META[row.kind].timed) return true;
  const endMs = Date.parse(row.endsAt ?? row.startsAt ?? "");
  return Number.isFinite(endMs) && endMs >= planStartMs;
}

function chipLabel(row: WhatsOnRow, timeLabel: string | null): string {
  const parts = [WHATS_ON_KIND_META[row.kind].badgeLabel];
  if (timeLabel) parts.push(timeLabel);
  const barePrice = whatsOnBarePriceGbp(row);
  if (barePrice !== null) parts.push(`£${barePrice.toFixed(2)}`);
  return parts.join(" · ");
}

function toChip(row: WhatsOnRow): StopEventChip {
  const timeLabel = laneTimeLabel(row);
  return {
    venueId: row.venueId as string,
    kind: row.kind,
    label: chipLabel(row, timeLabel),
    timeLabel,
    sourceLabel: row.source.label,
    sourceUrl: row.source.url,
    confidence: row.confidence,
    observedAt: row.observedAt,
  };
}

/**
 * Match at most one honest, hero-priority chip per requested stop venue. Rows
 * must already carry a resolved venueId — the same exact-venueId join
 * contract as the W1 badge join (summariseWhatsOnByVenue), never haversine.
 * Pure and React-free so it is directly unit-testable.
 */
export function stopEventChips(
  rows: readonly WhatsOnRow[],
  venueIds: readonly string[],
  planStartTimeIso: string,
  now: number = Date.now(),
): Map<string, StopEventChip> {
  const chips = new Map<string, StopEventChip>();
  if (!planStartsThisTonight(planStartTimeIso, now)) return chips;

  const wanted = new Set(venueIds);
  const planStartMs = Date.parse(planStartTimeIso);
  if (!Number.isFinite(planStartMs)) return chips;

  const byVenue = new Map<string, WhatsOnRow[]>();
  // One London clock reading for the whole sweep, not one per row.
  const tonight = tonightServiceWindow(now);
  for (const row of rows) {
    if (!row.venueId || !wanted.has(row.venueId)) continue;
    if (!isOnTonight(row, now, tonight)) continue;
    if (!isEventRelevantToPlanStart(row, planStartMs)) continue;
    const list = byVenue.get(row.venueId) ?? [];
    list.push(row);
    byVenue.set(row.venueId, list);
  }

  for (const [venueId, venueRows] of byVenue) {
    const hero = venueRows.slice().sort((a, b) => {
      const priorityDiff = WHATS_ON_KIND_META[a.kind].priority - WHATS_ON_KIND_META[b.kind].priority;
      if (priorityDiff !== 0) return priorityDiff;
      return Date.parse(a.startsAt ?? "") - Date.parse(b.startsAt ?? "");
    })[0];
    chips.set(venueId, toChip(hero));
  }
  return chips;
}
