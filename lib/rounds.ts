// The Round model — the shared vocabulary, the untrusted-input validators, and
// the short join-code generator. Types + pure helpers live here (no store import)
// so a route can validate inputs without pulling the storage backend into scope.
//
// A Round is a group crawl session friends join by a short code. Diary membership
// uses the Round capability and self-asserted handles; drink lines reach community
// price authority only through a separately authenticated account profile.

import { normalizeHandle } from "@/lib/profiles";
import { cleanText, readString } from "@/lib/textClean";
import { validateCommunityPrice } from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

// ── Join code ────────────────────────────────────────────────────────────────
// Short, human-shareable, spoken aloud ("tell your mates: JXKQ7M"). The alphabet
// deliberately drops the ambiguous glyphs (O/0, I/1, L, and — importantly — every
// vowel) so a code can never accidentally spell a word and can't be misheard as
// O-vs-0 or I-vs-1. 6 chars over a 26-symbol alphabet is ~309M combinations —
// plenty of headroom for a demo, and short enough to type.
export const ROUND_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789"; // no vowels, no O/0/I/1/L
export const ROUND_CODE_LENGTH = 6;

const CODE_CHARSET: ReadonlySet<string> = new Set(ROUND_CODE_ALPHABET.split(""));

/**
 * Generate one random join code. Uses crypto-grade randomness when available
 * (browser / Node globalThis.crypto) and falls back to Math.random only if the
 * platform has no crypto — a code is a low-stakes join key, never a secret, so
 * the fallback is acceptable and the caller (the store) retries on the rare
 * collision anyway via the DB's unique constraint.
 */
export function generateRoundCode(length = ROUND_CODE_LENGTH): string {
  const n = ROUND_CODE_ALPHABET.length;
  const out: string[] = [];
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i += 1) out.push(ROUND_CODE_ALPHABET[bytes[i] % n]);
  } else {
    for (let i = 0; i < length; i += 1) {
      out.push(ROUND_CODE_ALPHABET[Math.floor(Math.random() * n)]);
    }
  }
  return out.join("");
}

/**
 * Normalise an untrusted code to the canonical form (uppercase, alphabet-only).
 * Total + never throws: junk in yields a (possibly empty) safe code out. Used on
 * BOTH sides — codes are stored and looked up in this canonical form, so a mate
 * typing "jxkq7m " or "jxkq-7m" still resolves.
 */
export function normalizeRoundCode(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toUpperCase()
    .split("")
    .filter((ch) => CODE_CHARSET.has(ch))
    .join("")
    .slice(0, ROUND_CODE_LENGTH);
}

/** A code is valid iff it is exactly ROUND_CODE_LENGTH canonical chars. */
export function isValidRoundCode(raw: string | null | undefined): boolean {
  return normalizeRoundCode(raw).length === ROUND_CODE_LENGTH;
}

// ── Field caps ───────────────────────────────────────────────────────────────
export const ROUND_TITLE_MAX = 80;
export const VENUE_NAME_MAX = 120;
export const VENUE_ID_MAX = 80;
export const DROP_REF_MAX = 200;
export const ROUND_SPEND_CLIENT_REF_MAX = 80;
export const ROUND_SPEND_ITEM_NAME_MAX = 80;
export const ROUND_SPEND_ITEM_MAX = 20;
// How many of a turn's lines may be first-party price observations. The diary
// takes up to ROUND_SPEND_ITEM_MAX lines; this narrower ceiling is what the
// community store sees, and it bounds both the account budget one turn can spend
// and the number of limiter checks a phone tap waits on.
export const ROUND_SPEND_PRICE_LINE_MAX = 10;
export const ROUND_SPEND_TOTAL_MIN_PENCE = 100;
export const ROUND_SPEND_TOTAL_MAX_PENCE = 100_000;

// ── DTOs ─────────────────────────────────────────────────────────────────────
export type RoundStopDTO = {
  id: string;
  venueId: string;
  venueName: string;
  addedByHandle: string;
  /** The Pint Drop this stop was logged from, when it "built itself" from a drop. */
  dropRef?: string;
  createdAt: string;
};

export type RoundMemberDTO = {
  handle: string;
  joinedAt: string;
};

/**
 * Where a drink line's figure came from. "round" is the drinker's own claim,
 * so a signed-in account may send it to the community price store. "demo" is a
 * figure lifted straight off a seeded demo menu (lib/drinkSeeds): it is a real
 * part of the night's diary and nobody's observation, so it stops here.
 * Provenance is the gate, never the figure itself: a drinker who genuinely paid
 * a price a demo menu happens to quote is still observing it.
 *
 * The trust model, plainly: this is DECLARED by the client, not proved by the
 * server, so a crafted POST can label a demo figure "round". That is not a hole
 * a server check could close — a hand-typed price that coincides with a seed is
 * the same request as a re-emitted seed, and policy requires accepting the
 * first. What holds the line instead is what always held it: authenticated
 * account identity, corroboration and observation freshness before any map
 * surface, plus the Round route's account price budget
 * (app/api/rounds/[code]).
 */
export type RoundSpendItemSource = "round" | "demo";
export type RoundPromotionStatus =
  | "diary_only"
  | "legacy_unknown"
  | "pending"
  | "ready"
  | "promoted"
  | "superseded";

export type RoundPriceSource = Readonly<{
  spendId: string;
  lineIndex: number;
}>;

export type RoundSpendItemDTO = {
  drinkName: string;
  drinkCategory: DrinkCategory;
  pricePence: number;
  source: RoundSpendItemSource;
  promotionStatus: RoundPromotionStatus;
};

export type NewRoundSpendItem = Omit<RoundSpendItemDTO, "promotionStatus">;

export function resolveRoundPromotionStatus(
  source: RoundSpendItemSource,
  value: unknown,
): RoundPromotionStatus {
  if (
    value === "diary_only" ||
    value === "legacy_unknown" ||
    value === "pending" ||
    value === "ready" ||
    value === "promoted" ||
    value === "superseded"
  ) {
    return value;
  }
  return source === "demo" ? "diary_only" : "legacy_unknown";
}

/** The drink lines that claim first-party provenance. */
export function firstPartyPriceItems(
  items: readonly NewRoundSpendItem[],
): NewRoundSpendItem[] {
  return items.filter((item) => item.source === "round");
}

export function promotedPriceItems(
  items: readonly RoundSpendItemDTO[],
): RoundSpendItemDTO[] {
  return items.filter((item) => item.promotionStatus === "promoted");
}

export type RoundSpendDTO = {
  id: string;
  clientRef: string;
  payerHandle: string;
  recordedByHandle: string;
  venueId: string;
  venueName: string;
  totalPence: number;
  items: RoundSpendItemDTO[];
  recordedAt: string;
};

export type RoundDTO = {
  id: string;
  code: string;
  title: string;
  createdByHandle: string;
  createdAt: string;
  /** ISO string when the Round was closed, or null while it's still out. */
  closedAt: string | null;
};

/** The full live state the Round page renders (one GET). */
export type RoundState = {
  round: RoundDTO;
  members: RoundMemberDTO[];
  stops: RoundStopDTO[];
  spends: RoundSpendDTO[];
};

export type RoundViewState = RoundState & {
  viewerMemberHandle?: string;
};

// ── Write payloads (validated) ───────────────────────────────────────────────
export type NewRound = {
  title: string;
  createdByHandle: string;
};

export type NewStop = {
  venueId: string;
  venueName: string;
  addedByHandle: string;
  dropRef?: string;
};

export type NewRoundSpend = {
  clientRef: string;
  payerHandle: string;
  recordedByHandle: string;
  venueId: string;
  venueName: string;
  totalPence: number;
  items: NewRoundSpendItem[];
};

/**
 * Validate an untrusted create-Round payload. Returns null when it can't be
 * created: a missing/blank creator handle (the identity primitive) is the only
 * hard requirement — a blank title falls back to a friendly default so a Round is
 * never nameless. Title is cleaned free text (angle brackets / control chars
 * stripped, capped).
 */
export function cleanNewRound(input: {
  title?: unknown;
  createdByHandle?: unknown;
}): NewRound | null {
  const createdByHandle = normalizeHandle(readString(input.createdByHandle) ?? "");
  if (!createdByHandle) return null;
  const title = cleanText(input.title, ROUND_TITLE_MAX) || "Tonight's Round";
  return { title, createdByHandle };
}

/**
 * Validate an untrusted add-stop payload. Returns null when it can't be added: a
 * blank venue id, a blank venue name, or a blank adder handle. `dropRef` is
 * optional (the "builds itself" seam passes it; a manual add omits it).
 */
export function cleanNewStop(input: {
  venueId?: unknown;
  venueName?: unknown;
  addedByHandle?: unknown;
  dropRef?: unknown;
}): NewStop | null {
  const venueId = cleanText(input.venueId, VENUE_ID_MAX);
  const venueName = cleanText(input.venueName, VENUE_NAME_MAX);
  const addedByHandle = normalizeHandle(readString(input.addedByHandle) ?? "");
  if (!venueId || !venueName || !addedByHandle) return null;
  const dropRef = cleanText(input.dropRef, DROP_REF_MAX);
  return {
    venueId,
    venueName,
    addedByHandle,
    ...(dropRef ? { dropRef } : {}),
  };
}

function readMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[£\s]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validate one immutable buying turn. Item prices use the community-price
 * validator, so category, penny rounding, and per-drink limits cannot drift.
 * A plain total is deliberately a wider Round-only figure and never represents
 * a single drink. Each line declares its `priceSource`; only an explicit "demo"
 * marks a figure as lifted from a seeded menu, because everything else is a
 * drinker saying what they paid.
 */
export function cleanNewRoundSpend(input: {
  clientRef?: unknown;
  payerHandle?: unknown;
  recordedByHandle?: unknown;
  venueId?: unknown;
  venueName?: unknown;
  totalGbp?: unknown;
  items?: unknown;
}): NewRoundSpend | null {
  const clientRef = cleanText(input.clientRef, ROUND_SPEND_CLIENT_REF_MAX);
  const payerHandle = normalizeHandle(readString(input.payerHandle) ?? "");
  const recordedByHandle = normalizeHandle(readString(input.recordedByHandle) ?? "");
  const venueId = cleanText(input.venueId, VENUE_ID_MAX);
  const venueName = cleanText(input.venueName, VENUE_NAME_MAX);
  if (!clientRef || !payerHandle || !recordedByHandle || !venueId || !venueName) {
    return null;
  }

  if (input.items !== undefined && !Array.isArray(input.items)) return null;
  const rawItems = (input.items ?? []) as unknown[];
  if (rawItems.length > ROUND_SPEND_ITEM_MAX) return null;

  const items: NewRoundSpendItem[] = [];
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") return null;
    const row = rawItem as Record<string, unknown>;
    const drinkName = cleanText(row.drinkName, ROUND_SPEND_ITEM_NAME_MAX);
    if (!drinkName) return null;
    const price = validateCommunityPrice({
      venueId,
      drinkCategory: row.drinkCategory,
      priceGbp: row.priceGbp,
    });
    if (!price.ok) return null;
    items.push({
      drinkName,
      drinkCategory: price.value.drinkCategory,
      pricePence: Math.round(price.value.priceGbp * 100),
      source: readString(row.priceSource) === "demo" ? "demo" : "round",
    });
  }

  let totalPence: number;
  if (items.length > 0) {
    totalPence = items.reduce((sum, item) => sum + item.pricePence, 0);
  } else {
    const totalGbp = readMoney(input.totalGbp);
    if (totalGbp === null) return null;
    totalPence = Math.round(totalGbp * 100);
    if (
      totalPence < ROUND_SPEND_TOTAL_MIN_PENCE ||
      totalPence > ROUND_SPEND_TOTAL_MAX_PENCE
    ) {
      return null;
    }
  }

  return {
    clientRef,
    payerHandle,
    recordedByHandle,
    venueId,
    venueName,
    totalPence,
    items,
  };
}

export type RoundTurn = {
  currentHandle: string | null;
  lastPayerHandle: string | null;
};

/** Current buyer follows the latest payer in stable member join order. */
export function roundTurn(
  members: readonly RoundMemberDTO[],
  spends: readonly RoundSpendDTO[],
): RoundTurn {
  if (members.length === 0) {
    return { currentHandle: null, lastPayerHandle: null };
  }
  const latest = spends.at(-1);
  if (!latest) {
    return { currentHandle: members[0].handle, lastPayerHandle: null };
  }
  const payerIndex = members.findIndex((member) => member.handle === latest.payerHandle);
  const nextIndex = payerIndex >= 0 ? (payerIndex + 1) % members.length : 0;
  return {
    currentHandle: members[nextIndex].handle,
    lastPayerHandle: latest.payerHandle,
  };
}
