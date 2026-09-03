"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import SurfaceNav from "@/components/ui/surface-nav";
import { homeActionLabel } from "@/lib/surfaceStack";
import { useSheetHeightDrag } from "@/components/mobile/useSheetHeightDrag";
import { SheetFooterContext } from "@/components/mobile/sheetFooterContext";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { mobileSheetFocusContained, mobileSheetIsModal } from "@/lib/mobileSheetA11y";
import type { MapSheetDetent, MapSheetKind } from "@/lib/mobileShell";

/**
 * The mobile bottom sheet, rebuilt as a bottom-anchored flex column:
 *
 *   header (auto) / body (flex-1, min-height:0, overflow-auto) / footer (auto)
 *
 * The CONTAINER height is content-driven with `max-height: <snap cap>` (CSS,
 * mobileMapShell.css), so the sheet's rendered height is min(natural content,
 * cap): short content HUGS (no void) and tall content caps and scrolls inside
 * the body while header + footer stay pinned. There is no content measuring, no
 * translateY snap panel, and no reserved dock band — the box's visible bottom
 * edge is the viewport bottom and the last content pixel sits exactly a
 * safe-area inset above it. A drag grows/shrinks the box height directly
 * (useSheetHeightDrag writes an inline max-height in px); a release settles to a
 * snap cap. The footer slot holds the venue command bar (portaled in via
 * SheetFooterContext); contextual + planner sheets have no footer.
 */
export default function MobileSharedSheet({
  kind,
  title,
  initialSnap = "half",
  requestedSnap,
  onClose,
  onDismiss = onClose,
  closeLabel,
  backLabel = null,
  onBack,
  homeTitle = "the map",
  entranceOvershoot = false,
  onInterruptReveal,
  venueRevealSettleSequence = 0,
  children,
}: {
  kind: MapSheetKind | null;
  title: string;
  initialSnap?: MapSheetDetent;
  requestedSnap?: MapSheetDetent;
  /** Home: leave every open sheet and return to the map. */
  onClose: () => void;
  /** Gesture dismiss: Back to parent when one exists, otherwise Home. */
  onDismiss?: () => void;
  closeLabel?: string;
  /**
   * Back: return to the sheet that opened this one, with the state it held.
   * Null when this sheet opened over the map, where Back and Home are the same
   * journey and the leading slot stays empty (components/ui/surface-nav.tsx).
   */
  backLabel?: string | null;
  onBack?: () => void;
  /** What the host page calls its own top level, for the Home action's name. */
  homeTitle?: string;
  /** Beat 1 overshoot when the venue sheet opens at half. */
  entranceOvershoot?: boolean;
  /** Drop entrance classes on scroll, drag, Escape, or a second pick. */
  onInterruptReveal?: () => void;
  venueRevealSettleSequence?: number;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  const entranceOvershootRef = useRef(entranceOvershoot);
  const venueRevealSettleSequenceRef = useRef(venueRevealSettleSequence);
  const initialSnapRequestRef = useRef<MapSheetDetent | null>(null);
  useEffect(() => {
    entranceOvershootRef.current = entranceOvershoot;
  }, [entranceOvershoot]);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  const onInterruptRevealRef = useRef(onInterruptReveal);
  useEffect(() => {
    onInterruptRevealRef.current = onInterruptReveal;
  }, [onInterruptReveal]);
  const finishDismiss = useCallback(() => onDismissRef.current(), []);

  const {
    sheetSnap,
    setSheetSnap,
    settleToRest,
    openAtSnap,
    requestDismiss,
    sheetHeight,
    dragging,
    settling,
    onSheetDragStart,
    onSheetDragMove,
    onSheetDragEnd,
  } = useSheetHeightDrag(finishDismiss);
  const interruptAndSettle = useCallback(() => {
    entranceOvershootRef.current = false;
    onInterruptRevealRef.current?.();
    settleToRest();
  }, [settleToRest]);
  const interruptAndSettleRef = useRef(interruptAndSettle);
  useEffect(() => {
    interruptAndSettleRef.current = interruptAndSettle;
  }, [interruptAndSettle]);
  useEffect(() => {
    if (venueRevealSettleSequenceRef.current === venueRevealSettleSequence) return;
    venueRevealSettleSequenceRef.current = venueRevealSettleSequence;
    entranceOvershootRef.current = false;
    settleToRest("half");
  }, [settleToRest, venueRevealSettleSequence]);
  const requestClose = useCallback(() => {
    requestDismiss(sheetRef.current?.getBoundingClientRect().height);
  }, [requestDismiss]);
  // Escape steps back one level when there is a level to step back to, and
  // leaves for the map otherwise. It is the keyboard's Back, so it may not do
  // something the Back arrow beside it does not.
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);
  const requestEscape = useCallback(() => {
    const stepBack = onBackRef.current;
    if (stepBack) stepBack();
    else requestClose();
  }, [requestClose]);

  // On open: capture focus origin, reset to the requested opening snap, move
  // focus into the sheet, and wire Escape-to-close.
  //
  // Focus lands on the SHEET, not on its close button. Focusing the close
  // button put a visible focus ring on Dismiss for every reader the instant the
  // sheet opened, which is what made it the loudest object on the surface
  // (design judgement 2026-08-01, finding 2.16). The sheet itself is the
  // labelled dialog, so focusing it still moves assistive technology inside and
  // still starts the tab order at the top.
  useEffect(() => {
    if (!kind) {
      initialSnapRequestRef.current = null;
      return;
    }
    initialSnapRequestRef.current = initialSnap;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openAtSnap(initialSnap, {
      entranceOvershoot: kind === "venue" && entranceOvershootRef.current,
    });
    const frame = requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      // Claim the key so useMapKeyboardShortcuts' own Escape fallback (which
      // checks event.defaultPrevented) does not also step back for the same
      // press - otherwise one Escape pops two surface-stack levels at once.
      if (event.key === "Escape") {
        event.preventDefault();
        interruptAndSettleRef.current();
        requestEscape();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [initialSnap, kind, openAtSnap, requestEscape]);

  // PubMap/MobileMapShell can request a snap change (e.g. a content-tab tap
  // expands the venue sheet to full). Only re-applies on change.
  useEffect(() => {
    if (!kind || !requestedSnap) return;
    const initialSnapRequest = initialSnapRequestRef.current;
    initialSnapRequestRef.current = null;
    if (initialSnapRequest === requestedSnap) return;
    setSheetSnap(requestedSnap);
  }, [kind, requestedSnap, setSheetSnap]);

  // Modal focus trap at half and full: the scrim blocks pointer input to the map,
  // so keyboard focus must not walk the inert page behind an unreachable surface.
  // Peek is the tested exception — enough map stays live that trapping would lie.
  //
  // The policy is "map-surface", not "strict-modal": this sheet is a map surface
  // with body-level siblings that outrank it. The primary tab bar stays reachable
  // beside it, and so does the account onboarding dialog, which portals into
  // <body> and owns its own strict-modal trap over this sheet. A strict-modal
  // policy here inerted that dialog, so a new drinker could see the signup form
  // and type nothing into it.
  const sheetModal = mobileSheetIsModal(sheetSnap);
  useFocusTrap(
    Boolean(kind) && mobileSheetFocusContained(sheetSnap),
    sheetRef,
    "map-surface",
    previousFocus,
  );

  if (!kind || typeof document === "undefined") return null;
  // At the first level Home IS this sheet's close, so it keeps the sheet's own
  // name. Deeper down that name would be a lie: the control leaves every open
  // sheet, not this one, so it says where the reader lands instead.
  const closeButtonLabel = backLabel
    ? homeActionLabel(homeTitle)
    : closeLabel ??
      (kind === "venue"
        ? "Close venue detail"
        : kind === "planner"
          ? "Close planner"
          : `Close ${title}`);

  const sectionStyle: React.CSSProperties = {
    maxHeight: `${Math.max(0, sheetHeight)}px`,
    // Phone snaps change real geometry so the footer stays at the visible
    // bottom at peek, half, and full. Fence that layout work to this sheet and
    // drop compositor hints as soon as the spring rests.
    willChange: dragging || settling ? "max-height" : "auto",
  };

  return createPortal(
    <div
      className="mobileSheetPortal"
      data-sheet-kind={kind}
      /* How deep the reader is. Present so a browser test can assert the trail
         rather than infer it from which glyph happens to be drawn. */
      data-surface-back={backLabel ?? ""}
    >
      <button
        className="mobileSheetScrim"
        type="button"
        tabIndex={-1}
        onClick={requestClose}
        aria-label={`Dismiss ${title} backdrop`}
      />
      <section
        ref={sheetRef}
        className={`mapDrawer mobileSharedSheet ${kind === "venue" ? "right" : kind === "planner" ? "left" : "contextual"} open sheet-${sheetSnap}${dragging ? " sheet-dragging" : ""}${settling ? " sheet-settling" : ""}`}
        role={sheetModal ? "dialog" : undefined}
        aria-modal={sheetModal ? "true" : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        style={sectionStyle}
        onScrollCapture={interruptAndSettle}
      >
        <header
          className="mobileSharedSheetHeader sheetDragHandle"
          onPointerDown={(event) => {
            onInterruptRevealRef.current?.();
            onSheetDragStart(event);
          }}
          onPointerMove={onSheetDragMove}
          onPointerUp={onSheetDragEnd}
          onPointerCancel={onSheetDragEnd}
        >
          <button
            type="button"
            className="mobileSharedSheetDetent"
            aria-label={sheetSnap === "full" ? "Collapse sheet" : "Expand sheet"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setSheetSnap(sheetSnap === "full" ? "half" : "full")}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") setSheetSnap("full");
              if (event.key === "ArrowDown") setSheetSnap(sheetSnap === "peek" ? "peek" : "half");
            }}
          >
            <span className="mobileSharedSheetGrab" aria-hidden="true" />
          </button>
          {/* The header grid is `44px 1fr 44px`, and the leading cell used to
              sit empty while the trailing one held the only way out. SurfaceNav
              fills both: Back on the left when a sheet opened over another
              sheet, Home on the right always. */}
          <h2 id={titleId}>{title}</h2>
          {/* No `closeRef` here on purpose. SurfaceNav is borderless and quiet
              already, so the de-box intent survives inside it, and the sheet
              focuses ITSELF on open (see the open effect above) rather than the
              Home control. Handing this a ref would put the accent ring back on
              the way out the instant a sheet opened. */}
          <SurfaceNav backLabel={backLabel} onBack={onBack} homeLabel={closeButtonLabel} onHome={requestClose} />
        </header>
        <div className="mobileSharedSheetBody">
          <SheetFooterContext.Provider value={footerEl}>{children}</SheetFooterContext.Provider>
        </div>
        {/* Footer slot: the venue command bar portals in here (SheetFooterContext)
            so it is a real flex child BELOW the scroll body — always visible, in
            flow with the sheet during drag/snap. Empty (and CSS-collapsed) for
            contextual + planner sheets. */}
        <div className="mobileSharedSheetFooter" ref={setFooterEl} />
      </section>
    </div>,
    document.body,
  );
}
