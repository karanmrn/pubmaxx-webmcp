"use client";

// Add-to-Home-Screen install prompt (Cycle-4 Wave-C). A small branded bottom
// sheet that offers to put PUBMAXX on the home screen — but only AFTER PROVEN
// VALUE (a second-visit-day or a first completed night), never on first touch.
// All the policy lives in the pure gate lib/a2hsPrompt.ts; this component is
// the DOM shell around it: detect the platform, consume Android's event from
// the early root owner, and, when the gate says yes and the shared session
// prompt-budget is free — show one honest sheet.
//
// Two paths:
//  - Android/Chromium: A2HSTracking captures `beforeinstallprompt`, suppresses
//    the default mini-infobar, and retains it until this lazy surface arrives.
//  - iOS Safari: there is NO install API. We show the manual Share → Add to
//    Home Screen steps, honestly labelled Safari-only.
//
// Cross-lane etiquette: it claims the shared prompt budget (lib/promptBudget)
// so it never stacks on the first-run tour (#296) or the identity nudges lane,
// and it defers to the tour until that has been dismissed.
//
// Analytics: the pwa_install_prompt_available / pwa_install_completed /
// pwa_standalone_launch events are defined in the unmerged metrics-funnel
// branch (#301), NOT in this repo's lib/analyticsEvents registry. Per the lane
// brief we add NO registry entries and emit nothing here; the exact call sites
// are marked `POST-#301` below so the wiring is a one-line follow-up once #301
// lands.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Share, Plus, X } from "lucide-react";

import {
  detectA2hsPlatform,
  isNativeAppShell,
  evaluateA2hs,
  readA2hsState,
  recordA2hsVisit,
  registerDecline,
  registerDismissedForever,
  registerInstalled,
  writeA2hsState,
  type A2hsPlatform,
  type A2hsSurface,
} from "@/lib/a2hsPrompt";
import { completedCrawlCount } from "@/lib/crawlCompletion";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";
import { hasSeenTour } from "@/lib/firstRunTour";
import { dayBucketFromDate } from "@/lib/a2hsPrompt";
import {
  consumeA2hsInstallPrompt,
  getA2hsInstallPrompt,
  subscribeA2hsAppInstalled,
  subscribeA2hsInstallPrompt,
} from "@/lib/a2hsInstallEvent";
import "./a2hsInstallPrompt.css";

const BUDGET_SURFACE = "a2hs";
const EXIT_MS = 240;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readPlatform(): A2hsPlatform {
  if (typeof navigator === "undefined") return "unsupported";
  const nav = navigator as Navigator & { standalone?: boolean };
  let displayModeStandalone = false;
  try {
    displayModeStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  } catch {
    displayModeStandalone = false;
  }
  return detectA2hsPlatform({
    userAgent: nav.userAgent,
    navigatorStandalone: nav.standalone === true,
    displayModeStandalone,
    maxTouchPoints: nav.maxTouchPoints,
    // Native Capacitor shell (PR #313→#324): already the installed app, so the
    // gate must never offer "Add to Home Screen" inside it.
    isNativeApp: isNativeAppShell(),
  });
}

export default function A2HSInstallPrompt(): React.JSX.Element | null {
  const [mounted, setMounted] = useState(false);
  const [surface, setSurface] = useState<A2hsSurface | null>(null);
  const [closing, setClosing] = useState(false);
  const [installError, setInstallError] = useState("");
  const deferredPrompt = useSyncExternalStore(
    subscribeA2hsInstallPrompt,
    getA2hsInstallPrompt,
    () => null,
  );

  const platformRef = useRef<A2hsPlatform>("unsupported");
  const finalizedRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  // Play the exit animation, then run the terminal side effect and unmount.
  // Idempotent via finalizedRef, with a 0ms path under reduced motion.
  const finalize = useCallback((next: () => void) => {
    if (finalizedRef.current) return;
    setClosing(true);
    const run = () => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      next();
      setSurface(null);
    };
    window.setTimeout(run, prefersReducedMotion() ? 0 : EXIT_MS);
  }, []);

  // Close without a terminal outcome — record a decline so we honour the
  // 14-day cooldown before re-offering. Budget stays spent: it did interrupt.
  const close = useCallback(
    (persistDecline: boolean = true) => {
      finalize(() => {
        if (persistDecline) {
          writeA2hsState(registerDecline(readA2hsState(), dayBucketFromDate(new Date())));
        }
      });
    },
    [finalize],
  );

  const onAndroidInstall = useCallback(() => {
    setInstallError("");
    const evt = consumeA2hsInstallPrompt();
    if (!evt) {
      setInstallError("Could not start installation. Try again.");
      return;
    }
    void evt
      .prompt()
      .then(() => evt.userChoice)
      .then((choice) => {
        if (choice.outcome === "accepted") {
          // POST-#301: emit `pwa_install_completed` ({ platform: 'android' }).
          finalize(() => writeA2hsState(registerInstalled(readA2hsState())));
        } else {
          close(true);
        }
      })
      .catch(() => setInstallError("Could not start installation. Try again."));
  }, [close, finalize]);

  // "Don't ask again" — a hard opt-out (never re-offer on this device).
  const onNeverAsk = useCallback(() => {
    finalize(() => writeA2hsState(registerDismissedForever(readA2hsState())));
  }, [finalize]);

  // Re-run the gate. Called on mount, when Android's event lands, and when we
  // want to re-check. Sets the surface to show, claiming the prompt budget at
  // the moment we commit to showing (never merely on eligibility).
  const evaluate = useCallback(() => {
    if (finalizedRef.current || surface) return;
    // Defer to the first-run tour and any sibling prompt that already spent
    // the session budget — A2HS is never the second interruption in a session.
    if (!hasSeenTour()) return;
    if (!hasPromptBudgetFor(BUDGET_SURFACE)) return;

    const platform = platformRef.current;
    const decision = evaluateA2hs({
      platform,
      state: readA2hsState(),
      todayBucket: dayBucketFromDate(new Date()),
      planCompleted: completedCrawlCount() > 0,
      androidPromptReady: deferredPrompt !== null,
    });
    // POST-#301: when eligible, emit `pwa_install_prompt_available`
    // ({ platform }) here.
    if (!decision.show || !decision.surface) return;
    if (!claimPromptBudget(BUDGET_SURFACE)) return; // a sibling won the race
    setSurface(decision.surface);
  }, [deferredPrompt, surface]);

  // Flip the mount gate off the sync effect body (repo convention for
  // react-hooks/set-state-in-effect). Records today's visit day as a side
  // effect so the second-visit-day signal accrues.
  useEffect(() => {
    void Promise.resolve().then(() => {
      recordA2hsVisit(new Date());
      platformRef.current = readPlatform();
      setMounted(true);
    });
  }, []);

  // A2HSTracking owns native install events in the early root bundle. This
  // lazy surface only reacts to its internal completion handoff.
  useEffect(() => {
    const onInstalled = () => {
      close(false);
    };
    return subscribeA2hsAppInstalled(onInstalled);
  }, [close]);

  // First eligibility check once mounted (iOS has no event to wait for).
  useEffect(() => {
    if (mounted) evaluate();
  }, [mounted, evaluate]);

  // Focus management: remember prior focus, move into the sheet, restore after.
  useEffect(() => {
    if (!surface) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = window.requestAnimationFrame(() => cardRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      restoreFocusRef.current?.focus?.({ preventScroll: true });
      restoreFocusRef.current = null;
    };
  }, [surface]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
        return;
      }
      if (surface !== "ios" || e.key !== "Tab") return;
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
    [close, surface],
  );

  if (!surface) return null;

  const sheet = (
    <section
      ref={cardRef}
      className={`a2hsSheet a2hsSheet--${surface}${closing ? " isClosing" : ""}`}
      role={surface === "ios" ? "dialog" : "region"}
      aria-modal={surface === "ios" ? "true" : undefined}
      aria-labelledby="a2hsTitle"
      aria-describedby="a2hsBody"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocusCapture={(event) => {
        const previous = event.relatedTarget;
        if (
          previous instanceof HTMLElement &&
          !event.currentTarget.contains(previous)
        ) {
          restoreFocusRef.current = previous;
        }
      }}
    >
      <button
        type="button"
        className="a2hsClose pressable"
        onClick={() => close(true)}
        aria-label="Not now"
      >
        <X size={18} aria-hidden="true" />
      </button>

      <p className="a2hsEyebrow">Add to home screen</p>
      <h2 id="a2hsTitle" className="a2hsTitle">
        {surface === "android" ? "Install PUBMAXX" : "Put PUBMAXX on your home screen"}
      </h2>

      {surface === "android" ? (
        <>
          <p id="a2hsBody" className="a2hsBody">
            Listed pint prices, one tap away.
          </p>
          {installError ? (
            <p className="a2hsError" role="status">
              {installError}
            </p>
          ) : null}
          <div className="a2hsActions">
            <button type="button" className="a2hsNever" onClick={onNeverAsk}>
              Don&apos;t ask again
            </button>
            <button
              type="button"
              className="a2hsPrimary pressable"
              onClick={onAndroidInstall}
            >
              Install
            </button>
          </div>
        </>
      ) : (
        <>
          <p id="a2hsBody" className="a2hsBody">
            One tap to tonight, and once it&apos;s installed, PUBMAXX can send you
            price-drop and last-orders alerts. Works in Safari.
          </p>
          <ol className="a2hsSteps">
            <li className="a2hsStep">
              <span className="a2hsStepIcon" aria-hidden="true">
                <Share size={18} />
              </span>
              <span>
                Tap <strong>Share</strong> in Safari&apos;s toolbar.
              </span>
            </li>
            <li className="a2hsStep">
              <span className="a2hsStepIcon" aria-hidden="true">
                <Plus size={18} />
              </span>
              <span>
                Choose <strong>Add to Home Screen</strong>.
              </span>
            </li>
            <li className="a2hsStep">
              <span className="a2hsStepNum" aria-hidden="true">
                3
              </span>
              <span>
                Tap <strong>Add</strong>. PUBMAXX lands on your home screen.
              </span>
            </li>
          </ol>
          <div className="a2hsActions">
            <button type="button" className="a2hsPrimary pressable" onClick={() => close(true)}>
              Got it
            </button>
          </div>
          <button type="button" className="a2hsNever" onClick={onNeverAsk}>
            Don&apos;t ask again
          </button>
        </>
      )}
    </section>
  );

  if (surface === "android") return sheet;

  return (
    <div
      className={`a2hsScrim${closing ? " isClosing" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(true);
      }}
    >
      {sheet}
    </div>
  );
}
