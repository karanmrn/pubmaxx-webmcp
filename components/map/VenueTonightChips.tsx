"use client";

// Venue-sheet "on tonight" chips (Wave A · A1 — reconciled to the W1 primary
// spine). Under the venue title we surface what's on at THIS venue tonight —
// one glyph-led chip per kind — so a viewer sees "there's a quiz and live sport
// here" the instant they tap a pin, without leaving the sheet.
//
// Spine reconciliation (W1): the data source is now the PRIMARY What's-On spine
// (/api/whats-on — venueId-joined quiz/sport/deal/music pub events), NOT the
// CityMCP things-to-do city-events layer. Rows join to the venue by their OWN
// resolved `venueId` (exact match — no haversine), which is both cleaner and
// truer than the old name/coord match. The CityMCP things-to-do layer remains a
// secondary city-events surface (Discover lane / /tonight screen).
//
// Pure sheet DOM — no map-canvas involvement (respects the F1 freeze). Fail-
// soft: any fetch failure or no-match renders nothing; provenance ("checked
// <date>") rides the row so freshness is never implied beyond the upstream.
//
// React 19 safe: state writes are deferred out of the effect body and an
// AbortController cancels the in-flight fetch on unmount / venue change.

import { useEffect, useState } from "react";
import {
  CalendarClock,
  Music,
  Tag,
  Ticket,
  Tv,
  type LucideIcon,
} from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import {
  coveringObservedAt,
  isValidWhatsOnRow,
  parseKindObservedAt,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import { checkedLabel, WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";
import type { VenueRef } from "@/lib/tonight";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

// `asOf` is deliberately NOT read here. It is the freshest thing the whole
// answer can show, and this line covers only the kinds at this one venue.
type ApiResponse = { kindObservedAt?: unknown; rows?: unknown };

const KIND_ICON: Record<WhatsOnKind, LucideIcon> = {
  quiz: CalendarClock,
  sport: Tv,
  deal: Tag,
  music: Music,
  event: Ticket,
};

// Distinct kinds present at this venue tonight, in hero-priority order.
function kindsForVenue(rows: WhatsOnRow[], venueId: string | undefined): WhatsOnKind[] {
  if (!venueId) return [];
  const seen = new Set<WhatsOnKind>();
  for (const row of rows) {
    if (row.venueId === venueId) seen.add(row.kind);
  }
  return (Object.keys(WHATS_ON_KIND_META) as WhatsOnKind[])
    .sort((a, b) => WHATS_ON_KIND_META[a].priority - WHATS_ON_KIND_META[b].priority)
    .filter((k) => seen.has(k));
}

export default function VenueTonightChips(
  props: VenueRef & { revealChecked?: boolean; revealCheckedLate?: boolean },
): React.JSX.Element | null {
  const { id, revealChecked = false, revealCheckedLate = false } = props;
  const [kinds, setKinds] = useState<WhatsOnKind[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Reset when the inspected venue changes so a stale match never lingers.
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setKinds([]);
        setAsOf(null);
      }
    });
    void loadSurfaceJson<ApiResponse>(
      "/api/whats-on?window=tonight&limit=60",
      {
        signal: controller.signal,
        init: { headers: { accept: "application/json" } },
        validate: (body) => Array.isArray(body?.rows),
      },
      (body) => {
        const rows = Array.isArray(body.rows)
          ? body.rows.filter((r): r is WhatsOnRow => isValidWhatsOnRow(r))
          : [];
        const derived = kindsForVenue(rows, id);
        if (derived.length === 0) return;
        void Promise.resolve().then(() => {
          if (controller.signal.aborted) return;
          setKinds(derived);
          // This ONE line covers every kind on tonight at this venue, so it may
          // only claim the OLDEST of their dates - the opposite of the page
          // stamp, and for the opposite reason: a covering claim is as good as
          // its weakest member. A kind we cannot date makes the line undatable
          // rather than letting the rest of the row speak for it.
          setAsOf(coveringObservedAt(parseKindObservedAt(body.kindObservedAt), derived));
          // One signal per kind shown at this venue.
          for (const kind of derived) trackEvent("event_chip_view", { kind });
        });
      },
    );
    return () => controller.abort();
  }, [id]);

  if (kinds.length === 0) return null;
  const revealDatedCheck = revealChecked && asOf !== null;
  const revealDatedCheckLate = revealDatedCheck && revealCheckedLate;

  return (
    <div className="venueTonightChips" aria-label="On tonight at this venue">
      {kinds.map((kind) => {
        const Icon = KIND_ICON[kind];
        return (
          <span
            key={kind}
            className={revealDatedCheck ? "venueTonightChip venueRevealRecord" : "venueTonightChip"}
            data-kind={kind}
            data-reveal-delay={revealDatedCheck && !revealDatedCheckLate ? "2" : undefined}
          >
            <Icon size={12} aria-hidden="true" />
            {WHATS_ON_KIND_META[kind].badgeLabel}
          </span>
        );
      })}
      <span
        className={revealDatedCheck ? "venueTonightChecked venueRevealRecord" : "venueTonightChecked"}
        data-reveal-delay={revealDatedCheck && !revealDatedCheckLate ? "2" : undefined}
      >
        {checkedLabel(asOf).toLowerCase()}
      </span>
    </div>
  );
}
