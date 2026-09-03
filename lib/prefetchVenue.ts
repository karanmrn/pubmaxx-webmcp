// Prefetch-on-intent for the venue sheet (IDEAS A1).
//
// The instant a user shows intent toward a venue — hover on desktop,
// pointerdown/touchstart on mobile — we speculatively warm `/api/venue/[id]`
// so opening the sheet feels instant. The route is edge-cached hard
// (s-maxage=86400, SWR=1w), so a single warming request means the *real* fetch
// PubMap fires on select resolves from cache instead of the ~6 MB dataset path.
//
// This module is deliberately pure/injectable so its gating logic can be unit
// tested in a node env with NO DOM: `fetch`, the connection descriptor, and the
// idle scheduler are all overridable. The default export wires the browser
// globals. Callers attach `prefetchVenue(id)` to onPointerEnter (desktop) /
// onPointerDown / onTouchStart (mobile) on any venue-list row or venue link.

// A minimal shape of the NetworkInformation API we actually read. `saveData`
// and `effectiveType` are widely shipped on Chromium/Android; absent elsewhere,
// which we treat as "no signal, don't block".
export type ConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
};

export type PrefetchDeps = {
  // The fetcher. Injected so tests never touch the network. Defaults to the
  // global `fetch` in the browser wiring below.
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>;
  // The current connection descriptor (or null when the API is unavailable).
  connection: ConnectionLike | null;
  // Schedules the actual fetch after a short idle delay so a pointer that
  // merely passes over a row doesn't spam the API. Returns a cancel handle.
  // Injected so tests run it synchronously.
  schedule: (run: () => void, delayMs: number) => { cancel: () => void };
  // Set of keys already warmed this session (fire-once-per-key). Injected so a
  // caller can share one registry across many mount/unmounts.
  seen: Set<string>;
  // Idle delay before firing. A small value (default 120ms) is enough to shrug
  // off casual pointer-passes while still feeling speculative.
  delayMs?: number;
};

// Connections we refuse to prefetch on. `saveData` is the user's explicit
// "don't waste my data" signal; "slow-2g"/"2g" are too slow to spend a
// speculative round-trip on (the real fetch on select will do the work).
const BLOCKED_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);

// Pure gate: should we prefetch on this connection at all? Exported for direct
// unit testing without any scheduling or fetch machinery.
export function shouldPrefetch(connection: ConnectionLike | null): boolean {
  if (!connection) return true; // no signal → don't block
  if (connection.saveData === true) return false;
  if (
    typeof connection.effectiveType === "string" &&
    BLOCKED_EFFECTIVE_TYPES.has(connection.effectiveType)
  ) {
    return false;
  }
  return true;
}

// Builds the route URL for a venue id. Kept tiny + exported so callers and tests
// agree on the exact shape PubMap's own `warmVenueDetail` fetches.
export function venueDetailUrl(venueId: string): string {
  return `/api/venue/${encodeURIComponent(venueId)}`;
}

export type PrefetchHandle = {
  // Cancels a still-pending (idle-delayed) prefetch AND aborts an in-flight
  // request. Safe to call after completion (no-op). Callers wire this to the
  // matching pointerleave / unmount so a quick pass doesn't leave work running.
  cancel: () => void;
};

// The core, dependency-injected implementation. Given an id and deps, it:
//  1. no-ops on empty id or a blocked connection,
//  2. fires at most once per key (per the injected `seen` registry),
//  3. waits a short idle delay before fetching (dedupes casual passes),
//  4. is AbortController-safe — cancel() stops a pending timer or aborts the
//     in-flight request.
// A key is marked seen the moment the fetch actually STARTS (post-delay), so a
// cancelled pointer-pass can still be retried later. Errors are swallowed:
// prefetch is best-effort and never surfaces to the user.
export function createPrefetch(deps: PrefetchDeps) {
  const { fetch: doFetch, connection, schedule, seen, delayMs = 120 } = deps;

  return function prefetchVenue(venueId: string): PrefetchHandle {
    const noop: PrefetchHandle = { cancel: () => {} };
    if (!venueId) return noop;
    if (seen.has(venueId)) return noop;
    if (!shouldPrefetch(connection)) return noop;

    let controller: AbortController | null = null;
    let cancelled = false;

    const timer = schedule(() => {
      if (cancelled) return;
      // Mark seen only once we actually fire, so a cancelled idle-pass can be
      // retried. From here the key is spent for the session.
      seen.add(venueId);
      controller = new AbortController();
      Promise.resolve(doFetch(venueDetailUrl(venueId), { signal: controller.signal })).catch(
        () => {
          // Best-effort — a failed/aborted warm just means the real fetch on
          // select pays full cost. Never surfaces.
        },
      );
    }, delayMs);

    return {
      cancel: () => {
        cancelled = true;
        timer.cancel();
        controller?.abort();
      },
    };
  };
}

// Reads the NetworkInformation descriptor from a browser `navigator`, or null
// when the API is unavailable (Safari/Firefox/SSR). Kept separate so tests can
// exercise it directly.
export function readConnection(nav: unknown): ConnectionLike | null {
  if (!nav || typeof nav !== "object") return null;
  const conn = (nav as { connection?: unknown }).connection;
  if (!conn || typeof conn !== "object") return null;
  return conn as ConnectionLike;
}

// Browser wiring: a session-lived registry + timeout-based idle scheduler bound
// to the real globals. This is the singleton callers import; every row/link
// shares one `seen` set so fire-once is per-session, not per-component.
const sessionSeen = new Set<string>();

const prefetchVenue = createPrefetch({
  fetch: (url, init) =>
    typeof fetch === "function"
      ? fetch(url, init)
      : Promise.reject(new Error("fetch unavailable")),
  connection: typeof navigator !== "undefined" ? readConnection(navigator) : null,
  schedule: (run, delayMs) => {
    const handle = setTimeout(run, delayMs);
    return { cancel: () => clearTimeout(handle) };
  },
  seen: sessionSeen,
});

export default prefetchVenue;
