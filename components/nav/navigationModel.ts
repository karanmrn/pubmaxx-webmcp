import { LONDON_DAY_MS, londonHour, londonMsSinceMidnight } from "@/lib/londonHour";

export type PrimaryNavKey = "now" | "map" | "out" | "social" | "you";

export type PrimaryNavItem = {
  key: PrimaryNavKey;
  href: string;
  label: string;
  match: string[];
};

/**
 * The five durable destinations in the PUBMAXX shell. Moment is deliberately
 * modelled separately below because it is a compose action, never a location.
 * The time-aware Now href is applied at render time; Map stays canonical /map.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { key: "now", href: "/today", label: "Now", match: ["/today", "/tonight"] },
  { key: "map", href: "/map", label: "Map", match: ["/map"] },
  { key: "out", href: "/out", label: "Out", match: ["/out"] },
  {
    key: "social",
    href: "/social",
    label: "Social",
    // Keep retired aliases in the match set so soft clients light the canonical
    // destination while a permanent redirect settles.
    match: ["/social", "/discover", "/drinks", "/feed", "/stories", "/crawls"],
  },
  // You owns the profile surfaces under /u only. /pal (Pub Pal, the AI
  // concierge) is its OWN destination with no primary tab — it used to sit in
  // this match set and wrongly lit "You" on both the mobile tab bar and the
  // desktop nav (audit F10). Dropped so /pal maps to no active tab.
  { key: "you", href: "/u/you", label: "You", match: ["/u"] },
] as const;

/** The one hour the Now tab href turns over on, in the London wall clock. */
export const NOW_TAB_FLIP_HOUR = 17;

/** Now keeps /today and /tonight live. The tab href flips at 17:00 London. */
export function nowTabHref(at: Date = new Date()): "/today" | "/tonight" {
  return londonHour(at) < NOW_TAB_FLIP_HOUR ? "/today" : "/tonight";
}

/**
 * What the server, and the browser's hydrating pass, must render for the Now
 * tab.
 *
 * A clock read is NOT a server snapshot: `/` and `/map` are prerendered and held
 * by the CDN for up to an hour, so a document built at 16:30 and hydrated at
 * 17:10 would meet markup holding /today with a browser that had just decided
 * /tonight. The city-preference store beside this one takes the same shape and
 * for the same reason - a constant here, then `nowTabHref` flips it after mount.
 */
export const NOW_TAB_SERVER_HREF = "/today" as const;

export function serverNowTabHref(): "/today" {
  return NOW_TAB_SERVER_HREF;
}

/**
 * A timer that fires no sooner than this, so a clock the browser hands back
 * fractionally early cannot spin the re-arm into a tight loop.
 */
const NOW_TAB_MIN_DELAY_MS = 1_000;

/**
 * How long until the Now tab href can next CHANGE.
 *
 * Two boundaries only: 17:00, where /today becomes /tonight, and midnight,
 * where it turns back. This used to be a 30 second `setInterval` running for the
 * life of every page in both the tab bar and the desktop nav - two permanent
 * wakeups on every route, to notice something that moves twice a day.
 *
 * The answer is recomputed on every fire rather than doubled up, so a London DST
 * turn (01:00, which is INSIDE the midnight-to-17:00 leg) simply makes the next
 * arm an hour shorter or longer instead of drifting the boundary.
 */
export function msUntilNowTabFlip(at: Date = new Date()): number {
  const sinceMidnight = londonMsSinceMidnight(at);
  const flip = NOW_TAB_FLIP_HOUR * 60 * 60 * 1000;
  const next = sinceMidnight < flip ? flip : LONDON_DAY_MS;
  return Math.max(NOW_TAB_MIN_DELAY_MS, next - sinceMidnight);
}

export function subscribeNowTabHref(onStoreChange: () => void): () => void {
  let timer = 0;
  const arm = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      onStoreChange();
      arm();
    }, msUntilNowTabFlip());
  };
  // A backgrounded tab has its timers throttled and a suspended device runs none
  // at all, so coming back into view is its own reason to re-read the clock.
  const onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") return;
    onStoreChange();
    arm();
  };
  arm();
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export const MOMENT_NAV_ACTION = {
  key: "moment",
  href: "/moment",
  label: "Moment",
} as const;

export type MomentReturnTarget = string;

const BLOCKED_MOMENT_RETURN_PREFIXES = ["/api", "/admin", "/auth", "/moment"];

/**
 * Path-prefix active matching for primary nav destinations. "/" only matches
 * the home route exactly (every path starts with "/").
 */
export function navPathMatches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) =>
    prefix === "/"
      ? pathname === "/"
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Which durable primary destination owns `pathname`, if any. */
export function primaryNavKeyForPath(pathname: string): PrimaryNavKey | undefined {
  return PRIMARY_NAV_ITEMS.find((item) => navPathMatches(pathname, item.match))?.key;
}

export function safeMomentReturnTo(value: string | null | undefined): MomentReturnTarget {
  if (!value) return "/map";
  if (!value.startsWith("/") || value.startsWith("//")) return "/map";
  try {
    const url = new URL(value, "https://pubmaxxing.com");
    if (url.origin !== "https://pubmaxxing.com") return "/map";
    if (BLOCKED_MOMENT_RETURN_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return "/map";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/map";
  }
}

export function momentHref(returnTo: string | null | undefined): string {
  return `${MOMENT_NAV_ACTION.href}?returnTo=${encodeURIComponent(safeMomentReturnTo(returnTo))}`;
}
