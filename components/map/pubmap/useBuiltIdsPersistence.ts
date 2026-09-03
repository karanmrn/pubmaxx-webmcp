import { useEffect } from "react";

// Refresh-safety net: mirror the hand-built stops to localStorage. This effect
// ONLY writes storage (no setState — react-hooks/set-state-in-effect is an
// error here). The explicit Clear action removes the key via clearBuilt.
// Extracted verbatim from PubMap (F1).
export function useBuiltIdsPersistence(builtIds: string[], storageKey: string) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (builtIds.length) {
      window.localStorage.setItem(storageKey, JSON.stringify(builtIds));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  }, [builtIds, storageKey]);
}
