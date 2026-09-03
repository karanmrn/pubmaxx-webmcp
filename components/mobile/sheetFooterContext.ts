"use client";

import { createContext, useContext } from "react";

/**
 * The mobile portal sheet (MobileSharedSheet) is a bottom-anchored flex column:
 * header / scrollable body / footer. The venue command bar needs to live in the
 * FOOTER slot — outside the scroll body — yet it is authored deep inside
 * VenueInspector (which owns the tab + share state it drives). This context
 * hands the footer's DOM node down through the body so VenueStickyBar can
 * `createPortal` itself into the footer while keeping its props/state from
 * VenueInspector intact. React portals preserve the tree, so no state lifting is
 * needed. Null outside the sheet (desktop) — the bar then renders in place (and
 * is CSS-hidden above 640px anyway).
 */
export const SheetFooterContext = createContext<HTMLElement | null>(null);

/** The current sheet footer DOM node, or null when not inside a portal sheet. */
export function useSheetFooterSlot(): HTMLElement | null {
  return useContext(SheetFooterContext);
}
