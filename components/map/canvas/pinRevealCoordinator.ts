export type PinRevealReason = "tiles" | "pins" | "idle" | "timeout";
export type BasemapNoticeOwner = "none" | "timeout" | "errors";

export const BASEMAP_RETRY_NOTICE = {
  kind: "tiles",
  message: "Map background couldn't load. Tap Retry to try again.",
} as const;

export const PIN_PAINT_RETRY_NOTICE = {
  kind: "pins",
  message: "Pub pins are still drawing. Tap Retry to load them again.",
} as const;

export const VENUE_DATA_RETRY_NOTICE = {
  kind: "venues",
  message: "The pub list hasn't loaded. Tap Retry to fetch it again.",
} as const;

export const PIN_PAINT_RETRY_PENDING_NOTICE = {
  kind: "pins",
  message: "Loading the pub pins…",
} as const;

export const VENUE_DATA_RETRY_PENDING_NOTICE = {
  kind: "venues",
  message: "Fetching the pub list…",
} as const;

export const PIN_PAINT_RETRY_SPENT_NOTICE = {
  kind: "pins",
  message: "The pub pins still aren't drawing. Tap Retry to try once more.",
} as const;

export const VENUE_DATA_RETRY_SPENT_NOTICE = {
  kind: "venues",
  message: "The pub list still hasn't loaded. Tap Retry to try once more.",
} as const;

export type RevealTimeoutNotice =
  | typeof BASEMAP_RETRY_NOTICE
  | typeof PIN_PAINT_RETRY_NOTICE
  | typeof VENUE_DATA_RETRY_NOTICE;

export type PinRevealNoticeKind =
  | typeof PIN_PAINT_RETRY_NOTICE.kind
  | typeof VENUE_DATA_RETRY_NOTICE.kind;

/**
 * What the owner's venue-index read has answered. THREE-WAY on purpose: the
 * read settles either way, because a refusal still owes the honest empty state
 * rather than a stuck skeleton, so a single "ready" flag answers true for a
 * list that arrived AND for one that never will.
 */
export type VenueDataOutcome = "pending" | "ready" | "failed";

/** The notice a venue-index read owes the reader once it has REFUSED. */
export function venueDataFailureNotice(retrySpent: boolean) {
  return retrySpent ? VENUE_DATA_RETRY_SPENT_NOTICE : VENUE_DATA_RETRY_NOTICE;
}

/**
 * Extra taps while a venue Retry read is live start no second fetch.
 * The live read is the outcome; a clock is not.
 */
export function venueRetryMayDispatch(inFlight: boolean): boolean {
  return !inFlight;
}

/**
 * Spent resets only when a read answers ready. Clearing failed on a
 * dispatch commit is not a read.
 */
export function venueRetrySpentAfterRead(
  previous: boolean,
  outcome: VenueDataOutcome,
): boolean {
  if (outcome === "pending") return previous;
  return outcome === "failed";
}

/** What the venues toast says once the dispatched index read has spoken. */
export function venueRetrySettleNotice(outcome: VenueDataOutcome) {
  if (outcome === "pending") return VENUE_DATA_RETRY_PENDING_NOTICE;
  if (outcome === "failed") return VENUE_DATA_RETRY_SPENT_NOTICE;
  return null;
}

/**
 * The notice a readiness-ceiling reveal owes the reader, named after the signal
 * that actually missed. Blaming the background for a basemap that painted sends
 * the reader at a Retry that tears down a map already drawing, so a ceiling over
 * a painted basemap names the missing PUB DATA instead - and it separates the
 * two pin signals, because they have two different ways out: an unsettled
 * `pubs` source is the canvas's own to redraw, while a venue index that never
 * arrived belongs to the owner and no amount of redrawing will produce it. A
 * ceiling with everything ready owes NO notice: only the compositor
 * confirmation ran out, and the pins are on screen. An error-owned notice is
 * truthful until Retry rebuilds the map, so a timeout never overwrites it.
 */
export function revealTimeoutNotice(
  reason: PinRevealReason,
  currentOwner: BasemapNoticeOwner,
  signals: {
    basemapPainted: boolean;
    venueData: VenueDataOutcome;
    pinsPaintable: boolean;
  },
): RevealTimeoutNotice | null {
  if (reason !== "timeout" || currentOwner === "errors") return null;
  if (!signals.basemapPainted) return BASEMAP_RETRY_NOTICE;
  if (signals.venueData !== "ready") return VENUE_DATA_RETRY_NOTICE;
  if (!signals.pinsPaintable) return PIN_PAINT_RETRY_NOTICE;
  return null;
}

/**
 * What a spent pin Retry says when the signal it was meant to restore is still
 * missing. Distinct copy from the first ask, because a notice that came back
 * word for word reads as a button that did nothing.
 */
export function pinRetrySpentNotice(kind: PinRevealNoticeKind) {
  return kind === "venues"
    ? VENUE_DATA_RETRY_SPENT_NOTICE
    : PIN_PAINT_RETRY_SPENT_NOTICE;
}

/**
 * What the toast says while a dispatched pin Retry is still working. Same
 * reason the spent notice differs from the first ask: the sentence that raised
 * the Retry, left unchanged under the tap, reads as a button that did nothing.
 */
export function pinRetryPendingNotice(kind: PinRevealNoticeKind) {
  return kind === "venues"
    ? VENUE_DATA_RETRY_PENDING_NOTICE
    : PIN_PAINT_RETRY_PENDING_NOTICE;
}

type PinRevealCoordinatorOptions = {
  /**
   * Un-gates the local GeoJSON pins if the basemap never reports painted tiles,
   * so the pins can never stay hidden forever. This does NOT lift the parent
   * loading chrome — the pins un-gate behind the skeleton and become visible
   * only when the chrome lifts at a real reveal (or the ready ceiling).
   */
  pinRevealTimeoutMs: number;
  /**
   * Honest upper bound for firing the reveal when a required paint signal
   * never arrives. The loading skeleton stays up until a real qualifying frame
   * or this ceiling.
   */
  readyCeilingMs: number;
  hasBasemapPainted: () => boolean;
  hasPinsPaintable: () => boolean;
  /** Phone can reveal local pins on their own frame while basemap tiles load. */
  requiresBasemapPaint?: boolean;
  /**
   * Keep parent loading chrome up for one render after pin layers become
   * visible. The render that discovers source readiness was painted while
   * those layers were still hidden.
   */
  confirmVisibleFrameBeforeReveal?: boolean;
  /** Optional compositor guard after the confirmed visible render. */
  visibleFrameHoldMs?: number;
  setPinsVisible: (visible: boolean) => void;
  subscribeRender: (listener: () => void) => () => void;
  subscribeIdle: (listener: () => void) => () => void;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (handle: number) => void;
  canRecoverAfterTimeout?: () => boolean;
  onPaintAfterTimeout?: (generation: number) => void;
  onReveal?: (reason: PinRevealReason, generation: number) => void;
};

/**
 * Keeps local GeoJSON pins behind configured basemap and source paint signals,
 * then keeps parent loading chrome up until its configured visible-frame gate.
 * Every style rebuild owns one generation; callbacks from superseded styles
 * are harmless even when the browser delivers an old event late.
 *
 * Two independent clocks guard the two failure modes:
 *  - `pinRevealTimeoutMs`: a short fallback that un-gates the local pins so they
 *    never hang hidden. It does not lift the parent chrome.
 *  - `readyCeilingMs`: a longer honest upper bound that lifts the parent chrome
 *    even if a required signal never arrives. A consumer may turn that timeout
 *    into a soft retry notice (`revealTimeoutNotice`), and never into an
 *    unmounted canvas: the short fallback has already un-gated pin layers on
 *    the live style, so tearing it down here leaves a bare basemap or a
 *    "Map couldn't draw" card over pubs that were about to paint.
 */
export function createPinRevealCoordinator({
  pinRevealTimeoutMs,
  readyCeilingMs,
  hasBasemapPainted,
  hasPinsPaintable,
  requiresBasemapPaint = true,
  confirmVisibleFrameBeforeReveal = false,
  visibleFrameHoldMs = 0,
  setPinsVisible,
  subscribeRender,
  subscribeIdle,
  setTimer,
  clearTimer,
  canRecoverAfterTimeout,
  onPaintAfterTimeout,
  onReveal,
}: PinRevealCoordinatorOptions) {
  let generation = 0;
  let state:
    | "idle"
    | "gated"
    | "awaiting-visible-frame"
    | "revealed"
    | "cancelled" = "idle";
  let pinTimer: number | null = null;
  let ceilingTimer: number | null = null;
  let visibleTimer: number | null = null;
  let unsubscribeRender: (() => void) | null = null;
  let unsubscribeIdle: (() => void) | null = null;

  const clearPending = () => {
    if (pinTimer !== null) clearTimer(pinTimer);
    pinTimer = null;
    if (ceilingTimer !== null) clearTimer(ceilingTimer);
    ceilingTimer = null;
    if (visibleTimer !== null) clearTimer(visibleTimer);
    visibleTimer = null;
    unsubscribeRender?.();
    unsubscribeRender = null;
    unsubscribeIdle?.();
    unsubscribeIdle = null;
  };

  const cancelCurrent = () => {
    if (state === "gated" || state === "awaiting-visible-frame") {
      state = "cancelled";
    }
    clearPending();
  };

  const cancel = () => {
    generation += 1;
    cancelCurrent();
  };

  const arm = (): number => {
    cancelCurrent();
    generation += 1;
    const armedGeneration = generation;
    state = "gated";
    setPinsVisible(false);
    let pinsShown = false;

    const isCurrent = () => generation === armedGeneration && state === "gated";
    const showPins = () => {
      if (pinsShown) return;
      pinsShown = true;
      setPinsVisible(true);
    };
    const finishReveal = (reason: PinRevealReason) => {
      if (
        generation !== armedGeneration ||
        (state !== "gated" && state !== "awaiting-visible-frame")
      ) {
        return;
      }
      state = "revealed";
      clearPending();
      showPins();
      onReveal?.(reason, armedGeneration);
      if (reason !== "timeout" || !onPaintAfterTimeout) return;
      const scheduleTimeoutRecovery = () => {
        if (
          generation !== armedGeneration ||
          state !== "revealed" ||
          !hasBasemapPainted()
        ) return;
        const canRecover = canRecoverAfterTimeout?.() ?? true;
        clearPending();
        if (canRecover) onPaintAfterTimeout(armedGeneration);
      };
      unsubscribeRender = subscribeRender(scheduleTimeoutRecovery);
      unsubscribeIdle = subscribeIdle(scheduleTimeoutRecovery);
    };
    const reveal = (reason: Exclude<PinRevealReason, "timeout">) => {
      if (!isCurrent()) return;
      showPins();
      if (!confirmVisibleFrameBeforeReveal) {
        finishReveal(reason);
        return;
      }
      state = "awaiting-visible-frame";
      if (pinTimer !== null) clearTimer(pinTimer);
      pinTimer = null;
      unsubscribeRender?.();
      unsubscribeRender = null;
      unsubscribeIdle?.();
      unsubscribeIdle = null;
      unsubscribeRender = subscribeRender(() => {
        unsubscribeRender?.();
        unsubscribeRender = null;
        if (visibleFrameHoldMs <= 0) {
          finishReveal(reason);
          return;
        }
        visibleTimer = setTimer(
          () => finishReveal(reason),
          visibleFrameHoldMs,
        );
      });
    };
    const revealPainted = (reason: Exclude<PinRevealReason, "timeout">) => {
      if (
        !isCurrent() ||
        !hasPinsPaintable() ||
        (requiresBasemapPaint && !hasBasemapPainted())
      ) {
        return;
      }
      reveal(reason);
    };

    unsubscribeRender = subscribeRender(() =>
      revealPainted(requiresBasemapPaint ? "tiles" : "pins"),
    );
    unsubscribeIdle = subscribeIdle(() => revealPainted("idle"));
    // Short fallback: un-gate the local pins so they can't hang hidden. This
    // runs behind the still-present parent skeleton and never lifts the chrome.
    pinTimer = setTimer(() => {
      if (isCurrent()) showPins();
    }, pinRevealTimeoutMs);
    // Honest upper bound: lift the parent chrome if a required signal never arrives.
    ceilingTimer = setTimer(() => finishReveal("timeout"), readyCeilingMs);
    return armedGeneration;
  };

  const dispose = () => {
    cancel();
  };

  return { arm, cancel, dispose };
}
