// A linked social is the owner's OWN public handle, typed in by them and
// removable by them. It is public content on /u/[handle] by design, and it is
// the only part of the account surface that is: email, date of birth, gender
// and full name stay behind the owner-authenticated onboarding read
// (__tests__/profilesRoutePrivacy.test.ts pins that fence).
//
// Two closed sets, and the narrower one is NOT the connectable one.
// SOCIAL_PROVIDERS is everything a person may link this wave. Only the three in
// SOCIAL_OAUTH_PROVIDERS can ever complete an OAuth handshake, so lib/socialOAuth.ts
// keys its client ids, scopes and authorize URLs off that narrower set. Every
// provider is manual-linkable; a provider is never unlinkable because nobody
// registered an app for it.

export const SOCIAL_PROVIDERS = [
  "x",
  "instagram",
  "tiktok",
  "youtube",
  "letterboxd",
  "spotify",
  "snapchat",
  "strava",
  "linkedin",
  "website",
] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** Providers with a real OAuth app behind them. A strict subset. */
export const SOCIAL_OAUTH_PROVIDERS = ["x", "instagram", "tiktok"] as const;
export type SocialOAuthProvider = (typeof SOCIAL_OAUTH_PROVIDERS)[number];

export type SocialConnectionMode = "oauth" | "manual";
export type SocialAccountKind = "personal" | "professional";
export type SocialRefreshStatus =
  | "not_applicable"
  | "current"
  | "refresh_due"
  | "refresh_failed";
export type SocialRevocationState =
  | "not_applicable"
  | "active"
  | "unknown"
  | "pending"
  | "revoked"
  | "failed";

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === "string" && SOCIAL_PROVIDERS.includes(value as SocialProvider);
}

export function isSocialOAuthProvider(value: unknown): value is SocialOAuthProvider {
  return (
    typeof value === "string" && SOCIAL_OAUTH_PROVIDERS.includes(value as SocialOAuthProvider)
  );
}

export type StoredSocialConnection = {
  id: string;
  ownerId: string;
  provider: SocialProvider;
  mode: SocialConnectionMode;
  accountKind: SocialAccountKind;
  providerAccountId?: string;
  username?: string;
  profileUrl?: string;
  scopes: string[];
  accessTokenCiphertext?: string;
  refreshTokenCiphertext?: string;
  tokenExpiresAt?: string;
  refreshStatus: SocialRefreshStatus;
  consentVersion: string;
  fetchedAt?: string;
  upstreamRevocationState: SocialRevocationState;
  connectedAt: string;
  updatedAt: string;
};

export type PublicSocialConnection = {
  provider: SocialProvider;
  mode: SocialConnectionMode;
  accountKind: SocialAccountKind;
  status: "connected" | "action_required";
  username?: string;
  profileUrl?: string;
  scopes: string[];
  connectedAt: string;
  updatedAt: string;
};

/** Public DTO allow-list. Provider ids and credential material never cross it. */
export function publicSocialConnection(row: StoredSocialConnection): PublicSocialConnection {
  return {
    provider: row.provider,
    mode: row.mode,
    accountKind: row.accountKind,
    status:
      row.mode === "manual" ||
      (row.refreshStatus !== "refresh_failed" &&
        row.upstreamRevocationState === "active" &&
        (!row.tokenExpiresAt || Date.parse(row.tokenExpiresAt) > Date.now()))
        ? "connected"
        : "action_required",
    ...(row.username ? { username: row.username } : {}),
    ...(row.profileUrl ? { profileUrl: row.profileUrl } : {}),
    scopes: [...row.scopes],
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * What a stranger reading /u/[handle] gets: the platform, the name to print and
 * the link to follow. Never the mode, the scopes, the account kind or anything
 * an OAuth handshake left behind.
 */
export type PublicSocialLink = {
  provider: SocialProvider;
  label: string;
  mark: string;
  username: string;
  profileUrl: string;
};

type ProviderSpec = {
  label: string;
  /** Compact monogram. One system across ten platforms beats nine brand icons and one gap. */
  mark: string;
  /** Hosts accepted from a pasted link, already lowercased and without "www.". */
  hosts: readonly string[];
  /** Pull the username out of a pasted link's path segments. */
  fromPath: (segments: readonly string[]) => string | null;
  pattern: RegExp;
  canonical: (username: string) => string;
  placeholder: string;
  hint: string;
};

const SPECS: Record<Exclude<SocialProvider, "website">, ProviderSpec> = {
  x: {
    label: "X",
    mark: "X",
    hosts: ["x.com", "twitter.com", "mobile.twitter.com"],
    fromPath: (segments) => (segments.length === 1 ? segments[0] : null),
    pattern: /^[A-Za-z0-9_]{1,15}$/,
    canonical: (username) => `https://x.com/${username}`,
    placeholder: "@yourhandle",
    hint: "Add your X username, such as @yourhandle.",
  },
  instagram: {
    label: "Instagram",
    mark: "IG",
    hosts: ["instagram.com"],
    fromPath: (segments) => (segments.length === 1 ? segments[0] : null),
    pattern: /^[A-Za-z0-9._]{1,30}$/,
    canonical: (username) => `https://www.instagram.com/${username}/`,
    placeholder: "@yourhandle",
    hint: "Add your Instagram username, such as @yourhandle.",
  },
  tiktok: {
    label: "TikTok",
    mark: "TT",
    hosts: ["tiktok.com"],
    fromPath: (segments) =>
      segments.length === 1 && segments[0].startsWith("@") ? segments[0].slice(1) : null,
    pattern: /^[A-Za-z0-9._]{1,24}$/,
    canonical: (username) => `https://www.tiktok.com/@${username}`,
    placeholder: "@yourhandle",
    hint: "Add your TikTok username, such as @yourhandle.",
  },
  youtube: {
    label: "YouTube",
    mark: "YT",
    hosts: ["youtube.com"],
    fromPath: (segments) =>
      segments.length === 1 && segments[0].startsWith("@") ? segments[0].slice(1) : null,
    pattern: /^[A-Za-z0-9._-]{3,30}$/,
    canonical: (username) => `https://www.youtube.com/@${username}`,
    placeholder: "@yourhandle",
    hint: "Add your YouTube handle, such as @yourhandle.",
  },
  letterboxd: {
    label: "Letterboxd",
    mark: "LB",
    hosts: ["letterboxd.com"],
    fromPath: (segments) => (segments.length === 1 ? segments[0] : null),
    pattern: /^[A-Za-z0-9_]{2,15}$/,
    canonical: (username) => `https://letterboxd.com/${username}/`,
    placeholder: "yourname",
    hint: "Add your Letterboxd username.",
  },
  spotify: {
    label: "Spotify",
    mark: "SP",
    hosts: ["open.spotify.com", "spotify.com"],
    fromPath: (segments) =>
      segments.length === 2 && segments[0] === "user" ? segments[1] : null,
    pattern: /^[A-Za-z0-9._-]{1,64}$/,
    canonical: (username) => `https://open.spotify.com/user/${username}`,
    placeholder: "your profile link",
    hint: "Add your Spotify profile link or user id.",
  },
  snapchat: {
    label: "Snapchat",
    mark: "SC",
    hosts: ["snapchat.com"],
    fromPath: (segments) =>
      segments.length === 2 && segments[0] === "add" ? segments[1] : null,
    pattern: /^[A-Za-z0-9._-]{3,15}$/,
    canonical: (username) => `https://www.snapchat.com/add/${username}`,
    placeholder: "yourname",
    hint: "Add your Snapchat username.",
  },
  strava: {
    label: "Strava",
    mark: "ST",
    hosts: ["strava.com"],
    fromPath: (segments) =>
      segments.length === 2 && segments[0] === "athletes" ? segments[1] : null,
    pattern: /^[A-Za-z0-9._-]{1,40}$/,
    canonical: (username) => `https://www.strava.com/athletes/${username}`,
    placeholder: "your athlete link",
    hint: "Add your Strava athlete link or id.",
  },
  linkedin: {
    label: "LinkedIn",
    mark: "IN",
    hosts: ["linkedin.com", "uk.linkedin.com"],
    fromPath: (segments) => (segments.length === 2 && segments[0] === "in" ? segments[1] : null),
    pattern: /^[A-Za-z0-9-]{3,100}$/,
    canonical: (username) => `https://www.linkedin.com/in/${username}`,
    placeholder: "your profile link",
    hint: "Add your LinkedIn profile link.",
  },
};

const WEBSITE_SPEC = {
  label: "Website",
  mark: "WW",
  placeholder: "https://yoursite.com",
  hint: "Add a full web address that starts with https.",
} as const;

export function socialProviderLabel(provider: SocialProvider): string {
  return provider === "website" ? WEBSITE_SPEC.label : SPECS[provider].label;
}

export function socialProviderMark(provider: SocialProvider): string {
  return provider === "website" ? WEBSITE_SPEC.mark : SPECS[provider].mark;
}

export function socialProviderPlaceholder(provider: SocialProvider): string {
  return provider === "website" ? WEBSITE_SPEC.placeholder : SPECS[provider].placeholder;
}

/** Longest value a link field accepts, before any parsing. */
export const MAX_SOCIAL_LINK_LENGTH = 300;

export type SocialLinkInput = { provider: SocialProvider; value: unknown };
export type SocialLinkResult =
  | { ok: true; username: string; profileUrl: string }
  | { ok: false; error: string };

function parsedUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function validateWebsite(raw: string): SocialLinkResult {
  const url = parsedUrl(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return { ok: false, error: WEBSITE_SPEC.hint };
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".")) {
    return { ok: false, error: WEBSITE_SPEC.hint };
  }
  url.hash = "";
  return {
    ok: true,
    username: host.replace(/^www\./, ""),
    profileUrl: url.toString(),
  };
}

/**
 * One gate for every platform. A person may type a bare username or paste the
 * profile link; both land on the same canonical URL, so two people who linked
 * the same account the two different ways read identically on the card.
 */
export function validateSocialLink(input: SocialLinkInput): SocialLinkResult {
  if (!isSocialProvider(input.provider)) {
    return { ok: false, error: "That social service is not available." };
  }
  if (typeof input.value !== "string") {
    return { ok: false, error: `Add your ${socialProviderLabel(input.provider)} link.` };
  }
  const raw = input.value.trim();
  if (!raw || raw.length > MAX_SOCIAL_LINK_LENGTH) {
    return { ok: false, error: `Add your ${socialProviderLabel(input.provider)} link.` };
  }
  if (input.provider === "website") return validateWebsite(raw);

  const spec = SPECS[input.provider];
  let username = raw;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(raw)) {
    const url = parsedUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
      return { ok: false, error: spec.hint };
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!spec.hosts.includes(host)) return { ok: false, error: spec.hint };
    const fromPath = spec.fromPath(url.pathname.split("/").filter(Boolean));
    if (!fromPath) return { ok: false, error: spec.hint };
    username = fromPath;
  }

  username = username.replace(/^@+/, "");
  if (!spec.pattern.test(username)) return { ok: false, error: spec.hint };
  return { ok: true, username, profileUrl: spec.canonical(username) };
}

/**
 * The public card's links, in the declared provider order so the row never
 * reshuffles between reads. A row with no link to follow prints nothing.
 */
export function publicSocialLinks(
  rows: readonly StoredSocialConnection[],
): PublicSocialLink[] {
  const order = new Map(SOCIAL_PROVIDERS.map((provider, index) => [provider, index]));
  return rows
    .filter((row) => isSocialProvider(row.provider) && Boolean(row.profileUrl))
    .sort((a, b) => (order.get(a.provider) ?? 99) - (order.get(b.provider) ?? 99))
    .map((row) => ({
      provider: row.provider,
      label: socialProviderLabel(row.provider),
      mark: socialProviderMark(row.provider),
      username: row.username ?? socialProviderLabel(row.provider),
      profileUrl: row.profileUrl as string,
    }));
}
