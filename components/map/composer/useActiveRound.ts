import { useEffect, useState } from "react";

import { readActiveRoundCode, subscribeActiveRound } from "@/lib/activeRound";

/**
 * Active-Round detection for the "My Round" destination chip.
 * Read once after hydration; never blocks the composer.
 */
export function useActiveRound(): boolean {
  const [hasActiveRound, setHasActiveRound] = useState(false);

  useEffect(() => {
    // Async wrapper defers the setState to a microtask after hydration (same
    // idiom as detectSpeech above), so the server render and first client paint
    // agree on "no active Round" and the repo's set-state-in-effect rule is met.
    // subscribeActiveRound covers same-tab writes, cross-tab storage, and focus.
    let active = true;
    async function detectRound() {
      if (active) setHasActiveRound(Boolean(readActiveRoundCode()));
    }
    void detectRound();
    const unsubscribe = subscribeActiveRound(() => {
      if (active) setHasActiveRound(Boolean(readActiveRoundCode()));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return hasActiveRound;
}
