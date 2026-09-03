"use client";

// First-run map orientation — one band-colour beat after analytics consent.
// Landing acquisition W3: teach green / amber / dear / grey from the same
// vocabulary as MapKey, then dismiss. Moment/Social and the
// multi-step welcome are demoted; curated crawl waits until this is done.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";

import {
  claimTourPromptBudget,
  getTourSeenServerSnapshot,
  getTourSeenSnapshot,
  markTourSeen,
  shouldShowFirstRunTour,
  subscribeTour,
  tourHasPromptBudget,
} from "@/lib/firstRunTour";
import {
  restoredSessionHasExplicitIntent,
  searchHasExplicitMapIntent,
} from "@/lib/explicitMapIntent";
import {
  ORIENTATION_LEGEND_TITLE,
  orientationLegendRows,
} from "@/lib/mapPriceLegend";
import { readMobileMapSession } from "@/lib/mobileShell";
import { trackEvent } from "@/lib/analytics";
import { subscribePromptBudget } from "@/lib/promptBudget";
import "./firstRunTour.css";

/** Fallback finalize delay so we unmount even if animationend never fires. */
const EXIT_MS = 260;

const LEGEND_ROWS = orientationLegendRows();

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function FirstRunTour(): React.JSX.Element | null {
  const pathname = usePathname() ?? "";
  const seen = useSyncExternalStore(
    subscribeTour,
    getTourSeenSnapshot,
    getTourSeenServerSnapshot,
  );
  const hasPromptBudget = useSyncExternalStore(
    subscribePromptBudget,
    tourHasPromptBudget,
    () => false,
  );

  // Mount guard: first client render returns null (matching the SSR "seen"
  // snapshot) so there is never a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  // §4.7: freeze whether THIS arrival is an explicit/restored Map intent, so a
  // deep link suppresses the tour before the selected sheet mounts. Frozen at
  // mount from the arrival URL + restored session (the sentinel keeps `sel` in
  // the final URL, so the read is stable). Search params alone are enough here
  // — PlanningIntent-only arrivals carry sel/accept anyway.
  const [explicitIntent] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      searchHasExplicitMapIntent(window.location.search) ||
      restoredSessionHasExplicitIntent(readMobileMapSession())
    );
  });
  const [closing, setClosing] = useState(false);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const finalizedRef = useRef(false);

  // Flip the mount gate from an async microtask (never the sync effect body) per
  // react-hooks/set-state-in-effect — the repo convention (see app/feed/page.tsx).
  useEffect(() => {
    void Promise.resolve().then(() => setMounted(true));
  }, []);

  // Map-only, one-time gate (see lib/firstRunTour.ts) — AND the shared
  // one-prompt-per-session budget: don't open if a sibling surface (A2HS /
  // identity / push) already holds it. See docs/PROMPT_ORCHESTRATION.md.
  const active =
    shouldShowFirstRunTour({ mounted, seen, pathname, explicitIntent }) &&
    hasPromptBudget;

  // Claim the shared budget at the moment the tour actually shows, so an
  // eligible-but-hidden tour never starves a sibling. Idempotent for the tour.
  useEffect(() => {
    if (active) claimTourPromptBudget();
  }, [active]);

  // Dismiss → play exit, then persist. Idempotent via finalizedRef, with a
  // timer fallback so reduced-motion (no animationend) still finalizes.
  // `completed` distinguishes finishing (Got it) from an early skip/close/
  // backdrop/Esc dismissal, for the tour_complete event.
  const dismiss = useCallback((completed: boolean = false) => {
    if (finalizedRef.current) return;
    setClosing(true);
    const finalize = () => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      trackEvent("tour_complete", { completed });
      markTourSeen();
    };
    window.setTimeout(finalize, prefersReducedMotion() ? 0 : EXIT_MS);
  }, []);

  // Remember the pre-open focus so we can restore it on dismiss.
  useEffect(() => {
    if (!active) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the card so the first Tab lands inside and SR announces the dialog.
    const id = window.requestAnimationFrame(() => cardRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [active]);

  // Restore focus once the overlay is gone (seen flips true → unmount).
  useEffect(() => {
    if (seen && restoreFocusRef.current) {
      restoreFocusRef.current.focus?.();
      restoreFocusRef.current = null;
    }
  }, [seen]);

  // Esc closes; Tab is trapped within the card.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss(false);
        return;
      }
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || activeEl === card) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [dismiss],
  );

  const titleId = useId();
  const bodyId = useId();

  if (!active) return null;

  return (
    <div
      className={`tourScrim${closing ? " isClosing" : ""}`}
      // Backdrop click (only on the scrim itself, not the card) dismisses.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={cardRef}
        className="tourCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <button
          type="button"
          className="tourClose pressable"
          onClick={() => dismiss(false)}
          aria-label="Skip the tour"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="tourStep">
          <p className="tourEyebrow">The map</p>
          <h2 id={titleId} className="tourTitle">
            {ORIENTATION_LEGEND_TITLE}
          </h2>
          <p id={bodyId} className="tourBody">
            Pin colour is the listed pint band. Grey means nobody has logged a
            price the map can trust yet.
          </p>
          <ul className="tourLegend" aria-label="Pint price colours">
            {LEGEND_ROWS.map((row) => (
              <li key={row.tone} className="tourLegendRow">
                <i className={`mapPriceDot ${row.tone}`} aria-hidden="true" />
                <span>{row.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="tourActions">
          <button
            type="button"
            className="tourSkip pressable"
            onClick={() => dismiss(false)}
          >
            Skip
          </button>
          <button
            type="button"
            className="tourNext pressable"
            onClick={() => dismiss(true)}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
