// Wanted Wave A — places you mean to try, private to the owner.
//
// A Wanted is an account-owned pin: a resolved venue (curated or UK base), or a
// pending paste that could not be matched yet. The source URL is provenance
// only — never fetched server-side from Instagram/TikTok. Solo Wanted only in
// this wave (no collaborative swipe, no streaks, no snaps/TTL).

import { presentableDescription } from "@/lib/slopFilter";
import { cleanText } from "@/lib/textClean";
import { UK_BASE_ID_PREFIX } from "@/lib/ukBasePubs";

export const MAX_WANTED_NOTE = 140;
export const MAX_WANTED_RAW_PASTE = 500;
export const MAX_WANTED_SOURCE_URL = 2_000;
export const MAX_WANTED_VENUE_ID = 64;
export const MAX_WANTED_VENUE_NAME = 120;

export type WantedVenueKind = "curated" | "uk_base" | "pending";

export type WantedStatus = "open" | "fulfilled";

export type WantedSourcePlatform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "other"
  | "none";

/** Validated fields the store persists (id + timestamps stamped by the store). */
export type WantedFields = {
  /** Stable profile actor (`profile:{uuid}`). Never a free-text handle alone. */
  ownerActor: string;
  venueKind: WantedVenueKind;
  /** Curated or uk-base id when resolved; "" when pending. */
  venueId: string;
  /** Display name when resolved; "" when pending. */
  venueName: string;
  /** Optional provenance URL. Stored, never fetched from Meta/TikTok. */
  sourceUrl: string;
  sourcePlatform: WantedSourcePlatform;
  note: string;
  /** Raw paste when unresolvable (or the original input for audit). */
  rawPaste: string;
};

export type Wanted = WantedFields & {
  id: string;
  status: WantedStatus;
  createdAt: string;
  fulfilledAt: string | null;
  promotedListType: string | null;
  promotedAt: string | null;
};

export type WantedDTO = Wanted;

export function isWantedPromotable(wanted: WantedDTO): boolean {
  return (
    wanted.status === "open"
    && wanted.venueKind === "curated"
    && wanted.venueId.trim().length > 0
    && !wanted.promotedListType
  );
}

export type WantedValidation =
  | { ok: true; value: WantedFields }
  | { ok: false; error: string };

/** A confirmable match from paste resolve (browser-safe type). */
export type WantedResolveCandidate = {
  venueId: string;
  venueName: string;
  venueKind: Exclude<WantedVenueKind, "pending">;
  address: string;
  contextLabel: string;
};

export type WantedResolveResult = {
  query: string;
  sourceUrl: string;
  sourcePlatform: WantedSourcePlatform;
  rawPaste: string;
  status: "ready" | "degraded" | "empty_query";
  candidates: WantedResolveCandidate[];
};

const HTTP_URL_RE = /^https?:\/\/[^\s]+$/i;

/** Hosts we recognise for provenance labels. Never scraped. */
const PLATFORM_HOSTS: ReadonlyArray<{
  platform: Exclude<WantedSourcePlatform, "none" | "other">;
  hosts: readonly string[];
}> = [
  { platform: "instagram", hosts: ["instagram.com", "www.instagram.com"] },
  { platform: "tiktok", hosts: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"] },
  {
    platform: "youtube",
    hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
  },
];

export function isUkBaseVenueId(venueId: string): boolean {
  return venueId.startsWith(UK_BASE_ID_PREFIX);
}

export function detectSourcePlatform(url: string): WantedSourcePlatform {
  if (!url) return "none";
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const row of PLATFORM_HOSTS) {
      if (row.hosts.includes(host) || row.hosts.some((h) => host.endsWith(`.${h}`))) {
        return row.platform;
      }
    }
    return "other";
  } catch {
    return "none";
  }
}

/**
 * Split a paste into an optional provenance URL and a name query.
 * Never fetches the URL. A bare URL has an empty query (pending path).
 */
export function splitWantedPaste(raw: string): {
  query: string;
  sourceUrl: string;
  sourcePlatform: WantedSourcePlatform;
  rawPaste: string;
} {
  const rawPaste = cleanText(raw, MAX_WANTED_RAW_PASTE);
  if (!rawPaste) {
    return { query: "", sourceUrl: "", sourcePlatform: "none", rawPaste: "" };
  }

  const urlMatch = rawPaste.match(/https?:\/\/[^\s]+/i);
  let sourceUrl = "";
  if (urlMatch) {
    const candidate = urlMatch[0].replace(/[),.;]+$/g, "");
    if (candidate.length <= MAX_WANTED_SOURCE_URL && HTTP_URL_RE.test(candidate)) {
      try {
        // Refuse credential phishing shapes (userinfo in URL).
        const parsed = new URL(candidate);
        if (parsed.username || parsed.password) {
          sourceUrl = "";
        } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          sourceUrl = candidate.slice(0, MAX_WANTED_SOURCE_URL);
        }
      } catch {
        sourceUrl = "";
      }
    }
  }

  const query = cleanText(
    sourceUrl ? rawPaste.replace(sourceUrl, " ") : rawPaste,
    MAX_WANTED_VENUE_NAME,
  );

  return {
    query,
    sourceUrl,
    sourcePlatform: detectSourcePlatform(sourceUrl),
    rawPaste,
  };
}

export function cleanWantedNote(value: unknown): string {
  const cleaned = cleanText(value, MAX_WANTED_NOTE);
  if (!cleaned) return "";
  // Slop filter refuses junk; fall back to the cleaned note when it passes.
  return presentableDescription(cleaned) ?? cleaned;
}

export function validateWantedCreate(input: {
  ownerActor: string;
  venueKind?: unknown;
  venueId?: unknown;
  venueName?: unknown;
  sourceUrl?: unknown;
  note?: unknown;
  rawPaste?: unknown;
}): WantedValidation {
  const ownerActor =
    typeof input.ownerActor === "string" && input.ownerActor.startsWith("profile:")
      ? input.ownerActor
      : "";
  if (!ownerActor) {
    return { ok: false, error: "Sign in to save a Wanted place." };
  }

  const venueId = cleanText(input.venueId, MAX_WANTED_VENUE_ID);
  const venueName = cleanText(input.venueName, MAX_WANTED_VENUE_NAME);
  const rawPaste = cleanText(input.rawPaste, MAX_WANTED_RAW_PASTE);
  const note = cleanWantedNote(input.note);

  let sourceUrl = "";
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim()) {
    const candidate = input.sourceUrl.trim().slice(0, MAX_WANTED_SOURCE_URL);
    if (!HTTP_URL_RE.test(candidate)) {
      return { ok: false, error: "Use an http or https link." };
    }
    try {
      const parsed = new URL(candidate);
      if (parsed.username || parsed.password) {
        return { ok: false, error: "That link looks unsafe." };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Use an http or https link." };
      }
      sourceUrl = candidate;
    } catch {
      return { ok: false, error: "Use an http or https link." };
    }
  }

  const kindRaw = typeof input.venueKind === "string" ? input.venueKind : "";
  let venueKind: WantedVenueKind;
  if (kindRaw === "pending" || (!venueId && rawPaste)) {
    venueKind = "pending";
  } else if (kindRaw === "uk_base" || isUkBaseVenueId(venueId)) {
    venueKind = "uk_base";
  } else if (venueId) {
    venueKind = "curated";
  } else {
    return { ok: false, error: "Choose a pub, or paste a name we can keep pending." };
  }

  if (venueKind === "pending") {
    if (!rawPaste && !sourceUrl) {
      return { ok: false, error: "Paste a pub name or a link." };
    }
    return {
      ok: true,
      value: {
        ownerActor,
        venueKind: "pending",
        venueId: "",
        venueName: "",
        sourceUrl,
        sourcePlatform: detectSourcePlatform(sourceUrl),
        note,
        rawPaste: rawPaste || sourceUrl,
      },
    };
  }

  if (!venueId || !venueName) {
    return { ok: false, error: "Confirm the pub before saving." };
  }

  return {
    ok: true,
    value: {
      ownerActor,
      venueKind,
      venueId,
      venueName,
      sourceUrl,
      sourcePlatform: detectSourcePlatform(sourceUrl),
      note,
      rawPaste,
    },
  };
}

/** Quiet fulfilment line for the UI — one honest sentence, no theatre. */
export function wantedFulfilledLine(venueName: string): string {
  const name = cleanText(venueName, MAX_WANTED_VENUE_NAME) || "that pub";
  return `Wanted, done: you made it to ${name}.`;
}

/** Honest label for a pending (unresolved) Wanted. */
export function wantedPendingLabel(rawPaste: string): string {
  const paste = cleanText(rawPaste, 80) || "a place you pasted";
  return `Still matching: ${paste}`;
}
