// Structured skeleton for the venue sheet while `/api/venue/[id]` hydrates.
// Matches the sheet's tab + stamp layout so the loading state feels like the
// real panel, not a bare "Loading…" line.

import { useLayoutEffect, useRef, type CSSProperties } from "react";

import type { VenueRevealForm } from "@/lib/venueReveal";

export default function VenueSheetSkeleton({
  loadingLabel = "Loading full venue details…",
  revealForm = null,
  revealElapsedMs = null,
  revealStartedAt = null,
}: {
  loadingLabel?: string;
  revealForm?: VenueRevealForm | null;
  revealElapsedMs?: number | null;
  revealStartedAt?: number | null;
}) {
  const skeletonRef = useRef<HTMLDivElement>(null);
  const revealClasses = revealForm ? ` venueReveal venueReveal--${revealForm}` : "";
  const revealStyle =
    typeof revealElapsedMs === "number" && Number.isFinite(revealElapsedMs)
      ? ({
          "--venue-reveal-elapsed": `${Math.max(0, revealElapsedMs)}ms`,
        } as CSSProperties)
      : undefined;
  useLayoutEffect(() => {
    if (
      !skeletonRef.current ||
      typeof revealStartedAt !== "number" ||
      !Number.isFinite(revealStartedAt)
    ) {
      return;
    }
    skeletonRef.current.style.setProperty(
      "--venue-reveal-elapsed",
      `${Math.max(0, Date.now() - revealStartedAt)}ms`,
    );
  }, [revealStartedAt]);
  return (
    <div
      ref={skeletonRef}
      className={`venueSheetSkeleton${revealClasses}`}
      style={revealStyle}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="venueSheetSkeletonLabel">{loadingLabel}</span>
      <div
        className={`venueSheetSkeletonTitle${revealForm ? " venueRevealBloom" : ""}`}
        aria-hidden="true"
      />
      <div className="venueSheetSkeletonMeta" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="venueSheetSkeletonTabs" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="venueSheetSkeletonStamp" aria-hidden="true" />
      <div className="venueSheetSkeletonBody" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
