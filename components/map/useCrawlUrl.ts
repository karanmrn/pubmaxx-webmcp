"use client";

import { useEffect, useRef } from "react";

import { encodeCrawl, seedCrawlState, type CrawlUrlState } from "@/lib/crawlUrl";

// (a) seedCrawlState reads the URL once on mount for a lazy useState initializer;
// (b) useCrawlUrlSync writes crawl state back to the URL via history.replaceState,
// debounced ~300ms, so a shared link reproduces the crawl. No router dependency,
// SSR-guarded. Only WRITES to history — never calls setState (react-hooks safe).

export { seedCrawlState };

const DEBOUNCE_MS = 300;

// Owned Map params that encodeCrawl does not model but must survive a URL sync:
// the Drop-intent flag, planner deep link, Map-owner selection, accepted-handoff markers,
// and a base-pub selection's `at=` location hint
// (lib/mapSelectionHistory), and the honest UK place arrival coordinates.
// Without this merge the debounced replaceState would silently drop them the
// moment any crawl state changed.
const OWNED_PASSTHROUGH_PARAMS = [
  "log",
  "plan",
  "sel",
  "accept",
  "src",
  "at",
  "place",
  "lat",
  "lng",
  "uk",
  "mapNotice",
] as const;

export function mergeCrawlUrlSearch(
  encodedSearch: string,
  liveSearch: string,
  preserveCrawlParam = false,
): string {
  const params = new URLSearchParams(encodedSearch);
  const live = new URLSearchParams(liveSearch);
  for (const key of OWNED_PASSTHROUGH_PARAMS) {
    const value = live.get(key);
    if (value !== null && !params.has(key)) params.set(key, value);
  }
  const crawl = live.get("crawl");
  if (preserveCrawlParam && crawl !== null && !params.has("crawl")) {
    params.set("crawl", crawl);
  }
  return params.toString();
}

/**
 * The address a clean arrival is allowed to keep, until the reader changes
 * something themselves.
 *
 * A restored session put a previous visit's search back on the map, and the
 * sync then wrote it to the address bar: a typed `/map` became `/map?q=Camden`,
 * and a clean shared link mutated into somebody's stale search. The address the
 * reader typed wins. `encodedAtMount` is what the restored state encodes to, so
 * the first genuine change by the reader releases the hold and the sync resumes.
 */
export type CleanUrlHold = { encodedAtMount: string } | null;

/** May the sync write `encoded` to the address bar yet? */
export function crawlUrlWriteAllowed(
  hold: CleanUrlHold,
  encoded: string,
): boolean {
  return hold === null || encoded !== hold.encodedAtMount;
}

export function useCrawlUrlSync(
  state: CrawlUrlState,
  /** True when the reader arrived on a clean URL and a saved session was
   *  restored over it. The address then stays clean until they act. */
  holdCleanUrl = false,
  holdSeededCrawlParam = false,
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hold = useRef<CleanUrlHold | undefined>(undefined);
  const crawlHold = useRef<CleanUrlHold | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const encoded = encodeCrawl(state);
    if (hold.current === undefined) {
      hold.current = holdCleanUrl ? { encodedAtMount: encoded } : null;
    }
    if (crawlHold.current === undefined) {
      crawlHold.current = holdSeededCrawlParam ? { encodedAtMount: encoded } : null;
    }
    if (!crawlUrlWriteAllowed(hold.current, encoded)) return;
    hold.current = null;
    const preserveCrawlParam =
      crawlHold.current !== null &&
      crawlHold.current !== undefined &&
      holdSeededCrawlParam;
    if (!holdSeededCrawlParam) crawlHold.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const query = mergeCrawlUrlSearch(
        encoded,
        window.location.search,
        preserveCrawlParam,
      );
      // Keep a clean pathname when nothing meaningful is encoded (no trailing `?`).
      const url = query
        ? `${window.location.pathname}?${query}${window.location.hash}`
        : `${window.location.pathname}${window.location.hash}`;
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) {
        return;
      }
      window.history.replaceState(window.history.state, "", url);
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [holdCleanUrl, holdSeededCrawlParam, state]);
}
