"use client";

import { useCallback, useEffect, useState } from "react";

import { MAP_PIN_REVEAL_EVENT } from "@/lib/mapPinRevealEvent";

/**
 * Latches the canvas's painted-pin announcement, which is what lifts the held
 * loading frame. The latch is RESETTABLE on purpose: a canvas re-init (retry,
 * context loss) tears the map down and paints again, so a one-shot latch would
 * leave that load with no loading chrome at all. A city change needs no reset:
 * PubMaxingShell mounts PubMap with key={cityId}, so the latch starts false.
 */
export function useMapPinsRevealed(): {
  pinsRevealed: boolean;
  resetPinReveal: () => void;
} {
  const [pinsRevealed, setPinsRevealed] = useState(false);

  useEffect(() => {
    const onReveal = () => setPinsRevealed(true);
    window.addEventListener(MAP_PIN_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(MAP_PIN_REVEAL_EVENT, onReveal);
  }, []);

  const resetPinReveal = useCallback(() => setPinsRevealed(false), []);

  return { pinsRevealed, resetPinReveal };
}
