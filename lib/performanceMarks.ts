export type PubmaxPerformanceMark =
  | "pubmax:drop-tap"
  | "pubmax:drop-route-ready"
  | "pubmax:map-chunk-ready"
  | "pubmax:slim-venues-ready"
  | "pubmax:composer-mounted"
  | "pubmax:composer-interactive"
  | "pubmax:first-pins"
  | "pubmax:pin-entrance-settled";

const FIRST_PINS_EVENT = "pubmax:first-pins";
export const FIRST_PINS_SEEN_KEY = "pubmax:first-pins-seen:v1";

declare global {
  interface Window {
    __pubmaxFirstPinsReady?: boolean;
  }
}

export function markPubmaxTiming(name: PubmaxPerformanceMark): void {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    try {
      performance.mark(name);
    } catch {
      // Timing marks are diagnostic only; locked-down browsers should not break UI.
    }
  }
  if (name !== FIRST_PINS_EVENT || typeof window === "undefined") return;
  try {
    window.__pubmaxFirstPinsReady = true;
    try {
      window.localStorage.setItem(FIRST_PINS_SEEN_KEY, "1");
    } catch {
      // A blocked storage area must not affect the first-pins signal.
    }
    window.dispatchEvent(new Event(FIRST_PINS_EVENT));
  } catch {
    // The first-pins signal is an enhancement gate. A restricted event API
    // must never affect map rendering or its timing mark.
  }
}
