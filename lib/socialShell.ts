import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";

export type SocialFeedLane = "following" | "nearby" | "discover";

export type SocialPostsShellState = {
  valid: boolean;
  tab: "posts";
  feed: SocialFeedLane;
  area: NightAreaSlug | null;
};

export type SocialDiscoverShellState = {
  valid: boolean;
  tab: "discover";
  feed: null;
  area: null;
};

export type SocialShellState = SocialPostsShellState | SocialDiscoverShellState;

const SAFE_DEFAULT: SocialPostsShellState = {
  valid: false,
  tab: "posts",
  feed: "following",
  area: null,
};

const NIGHT_AREA_SET = new Set<string>(NIGHT_AREA_SLUGS);

function isSocialPostArea(value: string | null | undefined): value is NightAreaSlug {
  return typeof value === "string" && NIGHT_AREA_SET.has(value);
}

function paramsFrom(search: string | URLSearchParams): URLSearchParams {
  if (search instanceof URLSearchParams) return search;
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

export function parseSocialShellSearch(
  search: string | URLSearchParams,
): SocialShellState {
  const params = paramsFrom(search);
  const keys = [...params.keys()];
  if (keys.some((key) => !["tab", "feed", "area"].includes(key))) {
    return { ...SAFE_DEFAULT };
  }
  if (["tab", "feed", "area"].some((key) => params.getAll(key).length > 1)) {
    return { ...SAFE_DEFAULT };
  }

  const tab = params.get("tab");
  const feed = params.get("feed");
  const area = params.get("area");

  if (tab !== null) {
    if (tab !== "discover" || feed !== null || area !== null) {
      return { ...SAFE_DEFAULT };
    }
    return { valid: true, tab: "discover", feed: null, area: null };
  }

  if (feed === null) {
    if (area !== null) return { ...SAFE_DEFAULT };
    return { valid: true, tab: "posts", feed: "following", area: null };
  }

  if (feed === "following" || feed === "discover") {
    if (area !== null) return { ...SAFE_DEFAULT };
    return { valid: true, tab: "posts", feed, area: null };
  }

  if (feed === "nearby") {
    if (area !== null && !isSocialPostArea(area)) return { ...SAFE_DEFAULT };
    return { valid: true, tab: "posts", feed, area };
  }

  return { ...SAFE_DEFAULT };
}

export function socialShellHref(
  state:
    | Omit<SocialPostsShellState, "valid">
    | Omit<SocialDiscoverShellState, "valid">,
): string {
  if (state.tab === "discover") return "/social?tab=discover";
  if (state.feed === "following") return "/social";
  const params = new URLSearchParams({ feed: state.feed });
  if (state.feed === "nearby" && state.area) params.set("area", state.area);
  return `/social?${params.toString()}`;
}

export function socialFeedRequestHref(
  state: SocialShellState,
  cursor?: string | null,
): string | null {
  if (!state.valid || state.tab !== "posts") return null;
  if (state.feed === "nearby" && !state.area) return null;
  const params = new URLSearchParams({ lane: state.feed });
  if (state.feed === "nearby" && state.area) params.set("area", state.area);
  params.set("limit", "20");
  if (cursor) params.set("cursor", cursor);
  return `/api/social/posts?${params.toString()}`;
}
