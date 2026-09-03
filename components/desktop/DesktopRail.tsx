import type { ReactNode } from "react";

import "./desktopRail.css";

// Shared desktop right-rail host (Wave D2.1). A layout-only container that docks
// the always-on desktop rail blocks — Conditions, Area news, Night arc — into a
// single sticky column at >=1024. It is TRANSPARENT: each slot carries its own
// card chrome (ConditionsChip, AreaNewsRail, the future night-arc strip), so the
// rail owns only stacking, gap, and stickiness — never a second border/surface.
//
// The blocks are all fail-soft (they return null when they have nothing to say),
// and slots render as direct flex children, so an empty slot leaves no phantom
// gap. Named slots render in a FIXED order — Conditions, then Area news, then
// Night arc — so the owner's "Conditions first, always visible" contract is
// enforced by the host rather than each page's mount order.
//
// UNWIRED in D2: not mounted on any page yet. The Map (D3) and Tonight (D4)
// adapters drop their existing blocks into these slots, drop-in.

export type DesktopRailProps = {
  /** Tonight weather + drink verdict. Owner requirement: first, always visible. */
  conditions?: ReactNode;
  /** "New round here" dated area facts. */
  areaNews?: ReactNode;
  /** Night arc / get-home strip (future consumer). */
  nightArc?: ReactNode;
  /** Host-specific extra blocks, rendered after the named slots. */
  children?: ReactNode;
  /** Accessible name for the complementary landmark. */
  ariaLabel?: string;
  /** Host grid-placement / override hook (e.g. the map's right column). */
  className?: string;
};

export default function DesktopRail({
  conditions,
  areaNews,
  nightArc,
  children,
  ariaLabel = "At a glance",
  className,
}: DesktopRailProps) {
  // Nothing to host → render nothing, so a page that conditionally passes no
  // slots never leaves an empty complementary landmark in the tree.
  if (!conditions && !areaNews && !nightArc && !children) return null;

  const classes = className ? `desktopRail ${className}` : "desktopRail";

  return (
    <aside className={classes} aria-label={ariaLabel}>
      {conditions}
      {areaNews}
      {nightArc}
      {children}
    </aside>
  );
}
