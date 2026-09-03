import { useEffect, useRef } from "react";

type SelParamSyncArgs = {
  selParam: string;
  selectedVenueId: string;
  selectVenue: (id: string) => void;
};

// ?sel= is only read into the seed at mount, so a CLIENT navigation to
// /map?sel=<id> while the map is already mounted (e.g. "See on map" from a
// card, or back/forward) used to be ignored. Sync it: when the param changes
// to a venue that isn't the current selection, select it. The URL is the
// source of truth only in that direction — closing the sheet locally does
// not rewrite the param, matching the other seeded params' behaviour.
//
// Extracted verbatim from PubMap (F1). The ref-compare (NOT a dep) means only
// URL changes fire this — local selection changes never re-run it, and an
// already-matching selection is a no-op.
export function useSelParamSync({ selParam, selectedVenueId, selectVenue }: SelParamSyncArgs) {
  const selectedVenueIdRef = useRef(selectedVenueId);
  const selectVenueRef = useRef(selectVenue);
  useEffect(() => {
    selectedVenueIdRef.current = selectedVenueId;
    selectVenueRef.current = selectVenue;
  }, [selectedVenueId, selectVenue]);
  useEffect(() => {
    if (!selParam) return;
    // Microtask defer keeps the state updates out of the effect's synchronous
    // body (house lint rule against cascading renders). The ref comparison
    // (not a dep) means only URL changes fire this — local selection changes
    // never re-run it, and an already-matching selection is a no-op.
    queueMicrotask(() => {
      if (selParam !== selectedVenueIdRef.current) selectVenueRef.current(selParam);
    });
  }, [selParam]);
}
