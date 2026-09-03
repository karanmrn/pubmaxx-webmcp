"use client";

import { ChevronLeft, X } from "lucide-react";

import "./surfaceNav.css";

/**
 * The one way out of any surface in this product.
 *
 * Airbnb, Strava and Revolut share a shape, and it is not decoration: ONE
 * affordance at the leading edge of a panel's header, one at the trailing edge,
 * in the same place at the same size on every screen. Leading steps back one
 * level. Trailing leaves for the top. A reader learns it once.
 *
 * So this is not two buttons bolted onto every panel. At the first level Back
 * and Home are the same journey, so only the trailing control renders and the
 * leading slot stays empty. Back appears exactly when there is a parent to
 * return to, which is also when the reader can get lost.
 *
 * Both controls are quiet on purpose (design judgement 2026-08-01, findings 2.4
 * and 2.16). The venue sheet's close used to be a bordered box that drew a coral
 * ring on hover, which made the way out louder than the pub's name. Navigation
 * is not the content: no border and no fill at rest, and the accent is spent on
 * the focus ring alone, where it has a job.
 *
 * Neither control prints a word. The chevron and the cross are the two glyphs
 * every reader already knows, and a 320px sheet header has no room for a label
 * beside a pub's name. The destination lives in the accessible name, which is
 * where a reader who cannot see the glyph needs it.
 */
/**
 * The two icon sizes this affordance draws. Published rather than inlined
 * because a browser spec used to restate the number, so a size change here went
 * red over there with nothing having actually broken. A caller that wants to
 * assert the icon reads THIS.
 */
export const SURFACE_NAV_BACK_ICON_SIZE = 20;
export const SURFACE_NAV_HOME_ICON_SIZE = 19;

export default function SurfaceNav({
  backLabel,
  onBack,
  homeLabel,
  onHome,
  closeRef,
  className,
}: {
  /** Where Back goes, as a full accessible name. Null hides the control. */
  backLabel: string | null;
  onBack?: () => void;
  /** Where Home goes, as a full accessible name. */
  homeLabel: string;
  onHome: () => void;
  /** The host focuses this on open, so focus starts on the way out. */
  closeRef?: React.Ref<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <>
      {backLabel && onBack ? (
        <button
          type="button"
          className={`surfaceNavBack${className ? ` ${className}` : ""}`}
          aria-label={backLabel}
          onClick={onBack}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ChevronLeft size={SURFACE_NAV_BACK_ICON_SIZE} aria-hidden="true" />
        </button>
      ) : null}
      <button
        ref={closeRef}
        type="button"
        className={`surfaceNavHome${className ? ` ${className}` : ""}`}
        aria-label={homeLabel}
        onClick={onHome}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <X size={SURFACE_NAV_HOME_ICON_SIZE} aria-hidden="true" />
      </button>
    </>
  );
}
