"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  mapSurfaceOpenTransition,
  readMapSurfaceHistory,
  stampMapSurfaceHistory,
} from "@/lib/mapSurfaceHistory";
import {
  browseSelectionUrl,
  cleanMapUrl,
  refreshSelectionUrl,
  searchHasSelection,
  selectionResolution,
} from "@/lib/mapSelectionHistory";
import {
  ROOT_SURFACE_STACK,
  backActionLabel,
  currentSurface,
  type SurfaceEntry,
  type SurfaceStack,
} from "@/lib/surfaceStack";
import type { MapOverlay } from "@/lib/mobileShell";
import { announceAcceptedArrivalUrlChange, canonicalizeAcceptedArrivalSelection } from "@/lib/mapAcceptance";

export type MapSurfaceId = MapOverlay | "venue-list";

export type MapSurfaceState = {
  venueTab: string;
  venueId: string;
  areaTargetKey: string;
  areaTarget: unknown;
  layersTab: string;
};

export const EMPTY_MAP_SURFACE_STATE: MapSurfaceState = {
  venueTab: "",
  venueId: "",
  areaTargetKey: "",
  areaTarget: null,
  layersTab: "",
};

function sameState(a: MapSurfaceState | undefined, b: MapSurfaceState): boolean {
  return Boolean(
    a &&
      a.venueTab === b.venueTab &&
      a.venueId === b.venueId &&
      a.areaTargetKey === b.areaTargetKey &&
      a.layersTab === b.layersTab,
  );
}

function selectedVenueId(stack: SurfaceStack<MapSurfaceState>): string {
  const current = currentSurface(stack);
  return current?.id === "venue" ? current.state?.venueId ?? "" : "";
}

function currentBrowserUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function urlForStack(
  stack: SurfaceStack<MapSurfaceState>,
  selectionHint: string,
): string {
  const { pathname, search, hash } = window.location;
  const venueId = selectedVenueId(stack);
  const liveVenueId = new URLSearchParams(search).get("sel");
  return venueId
    ? liveVenueId === venueId
      ? refreshSelectionUrl(pathname, search, venueId, hash, selectionHint)
      : browseSelectionUrl(pathname, search, venueId, hash, selectionHint)
    : cleanMapUrl(pathname, search, hash);
}

/**
 * One Map navigation authority.
 *
 * Every surface open enters this hook synchronously. Each browser entry carries
 * the complete logical trail and, for a venue, the selection sentinel in that
 * same state object. Back and Forward restore the landed snapshot directly.
 * No second listener derives depth or negotiates a pending traversal.
 */
export function useMapSurfaceNavigation({
  arrivalSearch,
  surfaceId,
  surfaceTitle,
  surfaceState,
  selectionHint,
  onRestore,
  onHome,
}: {
  arrivalSearch: string;
  surfaceId: MapSurfaceId;
  surfaceTitle: string;
  surfaceState: MapSurfaceState;
  selectionHint: string;
  onRestore: (entry: SurfaceEntry<MapSurfaceState> | null) => void;
  onHome: () => void;
}) {
  const [stack, setStack] = useState<SurfaceStack<MapSurfaceState>>(
    ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>,
  );
  const stackRef = useRef(stack);
  const initialisedRef = useRef(false);
  const onRestoreRef = useRef(onRestore);
  const onHomeRef = useRef(onHome);
  const selectionHintRef = useRef(selectionHint);
  const publishStack = useCallback((next: SurfaceStack<MapSurfaceState>) => {
    stackRef.current = next;
    setStack(next);
  }, []);
  const publishInitialStack = useCallback((next: SurfaceStack<MapSurfaceState>) => {
    stackRef.current = next;
    queueMicrotask(() => setStack(next));
  }, []);

  useLayoutEffect(() => {
    onRestoreRef.current = onRestore;
    onHomeRef.current = onHome;
    selectionHintRef.current = selectionHint;
  }, [onHome, onRestore, selectionHint]);

  const open = useCallback(
    (entry: SurfaceEntry<MapSurfaceState>) => {
      if (!initialisedRef.current || typeof window === "undefined") return;
      const transition = mapSurfaceOpenTransition(stackRef.current, entry);
      publishStack(transition.stack);
      const state = stampMapSurfaceHistory(
        window.history.state,
        transition.stack,
        selectedVenueId(transition.stack),
      );
      const url = urlForStack(transition.stack, selectionHintRef.current);
      if (transition.kind === "push") {
        window.history.pushState(state, "", url);
      } else {
        window.history.replaceState(state, "", url);
      }
    },
    [publishStack],
  );

  useLayoutEffect(() => {
    if (initialisedRef.current || typeof window === "undefined") return;
    initialisedRef.current = true;

    const restored = readMapSurfaceHistory<MapSurfaceState>(window.history.state);
    if (restored !== null) {
      publishInitialStack(restored);
      return;
    }

    const root = ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>;
    const shown = surfaceId === "none"
      ? null
      : { id: surfaceId, title: surfaceTitle, state: surfaceState };
    const { pathname, search, hash } = window.location;
    const arrivalUrl = currentBrowserUrl();

    if (shown?.id === "venue" && searchHasSelection(arrivalSearch)) {
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, root, ""),
        "",
        cleanMapUrl(pathname, search, hash),
      );
      const selected = [shown] as SurfaceStack<MapSurfaceState>;
      window.history.pushState(
        stampMapSurfaceHistory(window.history.state, selected, shown.state.venueId),
        "",
        arrivalUrl,
      );
      publishInitialStack(selected);
      return;
    }

    window.history.replaceState(
      stampMapSurfaceHistory(window.history.state, root, ""),
      "",
      currentBrowserUrl(),
    );
    if (shown) open(shown);
  }, [arrivalSearch, open, publishInitialStack, surfaceId, surfaceState, surfaceTitle]);

  useLayoutEffect(() => {
    if (!initialisedRef.current || typeof window === "undefined") return;
    const shown = surfaceId === "none"
      ? null
      : { id: surfaceId, title: surfaceTitle, state: surfaceState };
    const current = currentSurface(stackRef.current);
    // Browser history is authoritative. A transient empty render while a
    // landed snapshot restores may never be interpreted as a second Home
    // traversal. All deliberate exits call back() or home() directly.
    if (!shown) return;
    if (
      current?.id === shown.id &&
      current.title === shown.title &&
      sameState(current.state, shown.state)
    ) {
      return;
    }
    open(shown);
  }, [open, surfaceId, surfaceState, surfaceTitle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = (event: PopStateEvent) => {
      const landed = readMapSurfaceHistory<MapSurfaceState>(event.state);
      const next = landed ?? (ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>);
      if (landed !== null && !selectedVenueId(next)) {
        const { pathname, search, hash } = window.location;
        const cleanUrl = cleanMapUrl(pathname, search, hash);
        if (currentBrowserUrl() !== cleanUrl) {
          window.history.replaceState(event.state, "", cleanUrl);
        }
      }
      publishStack(next);
      onRestoreRef.current(currentSurface(next));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [publishStack]);

  const back = useCallback(() => {
    if (!stackRef.current.length || typeof window === "undefined") return;
    window.history.back();
  }, []);

  const resolveSelection = useCallback(
    (requestedVenueId: string, canonicalVenueId: string) => {
      if (
        typeof window === "undefined" ||
        !requestedVenueId ||
        !canonicalVenueId
      ) {
        return;
      }
      const held = stackRef.current;
      const current = currentSurface(held);
      const { pathname, search, hash } = window.location;
      const resolution = selectionResolution({
        requestedVenueId,
        canonicalVenueId,
        currentVenueId: current?.id === "venue" ? current.state?.venueId ?? null : null,
        liveSelectedVenueId: new URLSearchParams(search).get("sel"),
      });
      if (resolution.kind === "none") return;
      if (resolution.kind === "canonicalise") {
        const canonicalUrl = canonicalizeAcceptedArrivalSelection({
          pathname,
          search,
          hash,
          requestedVenueId,
          canonicalVenueId: resolution.venueId,
        });
        if (!canonicalUrl) return;
        const next = current?.id === "venue"
          ? [...held.slice(0, -1), {
              ...current,
              state: { ...current.state, venueId: resolution.venueId },
            }] as SurfaceStack<MapSurfaceState>
          : held;
        if (next !== held) publishStack(next);
        window.history.replaceState(
          stampMapSurfaceHistory(window.history.state, next, resolution.venueId),
          "",
          canonicalUrl,
        );
        announceAcceptedArrivalUrlChange();
        return;
      }
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, held, selectedVenueId(held)),
        "",
        cleanMapUrl(pathname, search, hash),
      );
    },
    [publishStack],
  );

  const rejectSelection = useCallback(
    (venueId: string) => {
      if (typeof window === "undefined" || !venueId) return;
      const held = stackRef.current;
      const current = currentSurface(held);
      if (current?.id === "venue" && current.state?.venueId === venueId) {
        back();
        return;
      }
      const { pathname, search, hash } = window.location;
      if (new URLSearchParams(search).get("sel") !== venueId) return;
      window.history.replaceState(
        stampMapSurfaceHistory(window.history.state, held, selectedVenueId(held)),
        "",
        cleanMapUrl(pathname, search, hash),
      );
    },
    [back],
  );

  const home = useCallback(() => {
    const held = stackRef.current;
    if (!held.length) return;
    publishStack(ROOT_SURFACE_STACK as SurfaceStack<MapSurfaceState>);
    onHomeRef.current();
    if (typeof window !== "undefined") window.history.go(-held.length);
  }, [publishStack]);

  return useMemo(
    () => ({
      backLabel: backActionLabel(stack),
      back,
      home,
      open,
      rejectSelection,
      resolveSelection,
      holdsSurface: (id: MapSurfaceId) => stack.some((entry) => entry.id === id),
    }),
    [back, home, open, rejectSelection, resolveSelection, stack],
  );
}
