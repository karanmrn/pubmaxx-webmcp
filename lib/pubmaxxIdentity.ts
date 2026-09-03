import { normalizeHandle } from "@/lib/profiles";
import { HANDLE_MAX } from "@/lib/handleNormalize";

export const HANDLE_RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1_000;

const HANDLE_MIN = 3;
const HANDLE_PATTERN = new RegExp(`^[a-z0-9_]{${HANDLE_MIN},${HANDLE_MAX}}$`);
export const RESERVED_CONTRIBUTOR_HANDLES = [
  "karan",
  "sarah",
  "carol",
  "erin",
  "nikhil",
  "tiffany",
  "karanmanoharan",
  "karanszn",
  "karanm",
  "karanmrn",
  "kai",
  "janaki",
  "manoharan",
] as const;
const RESERVED_CONTRIBUTOR_HANDLE_SET = new Set<string>(
  RESERVED_CONTRIBUTOR_HANDLES,
);
const RESERVED_EXACT = new Set([
  "admin",
  "api",
  "help",
  "moderation",
  "official",
  "pubmaxx",
  "pubmaxxer",
  "pubmaxxing",
  "root",
  "safety",
  "staff",
  "support",
  "system",
]);
const RESERVED_BRAND_PATTERN = /^(?:pubmaxx|pubmaxxing|pubmaxxer)[_-]?(?:admin|help|official|safety|staff|support)$/;
const BLOCKED_TERMS = new Set(["fuck", "fucker", "nigger", "nigga"]);

export type HandleAssessment =
  | { ok: true; handle: string }
  | { ok: false; reason: "invalid" | "reserved"; error: string };

export function isReservedContributorHandle(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return RESERVED_CONTRIBUTOR_HANDLE_SET.has(
    raw.trim().replace(/^@/, "").toLowerCase(),
  );
}

/**
 * Validate a user-facing handle without silently accepting punctuation.
 * A leading @, surrounding whitespace, and letter casing are presentation
 * differences; every other character must already be in the canonical
 * [a-z0-9_] alphabet.
 */
export function assessPubmaxxHandle(raw: unknown): HandleAssessment {
  if (typeof raw !== "string") {
    return { ok: false, reason: "invalid", error: "Choose a handle between 3 and 30 characters." };
  }
  const presented = raw.trim().replace(/^@/, "").toLowerCase();
  const handle = normalizeHandle(raw);
  if (!HANDLE_PATTERN.test(presented) || handle !== presented) {
    return {
      ok: false,
      reason: "invalid",
      error: "Use 3–30 letters, numbers, or underscores.",
    };
  }
  const pieces = handle.split("_").filter(Boolean);
  if (isReservedContributorHandle(handle)) {
    return {
      ok: false,
      reason: "reserved",
      error: "That handle is not available.",
    };
  }
  if (
    RESERVED_EXACT.has(handle) ||
    RESERVED_BRAND_PATTERN.test(handle) ||
    pieces.some((piece) => BLOCKED_TERMS.has(piece))
  ) {
    return { ok: false, reason: "reserved", error: "That handle is reserved." };
  }
  return { ok: true, handle };
}

export type HandleRenameDecision =
  | { allowed: true }
  | { allowed: false; retryAt: string };

export function evaluateHandleRename(input: {
  changedAt?: string | null;
  now?: number;
}): HandleRenameDecision {
  if (!input.changedAt) return { allowed: true };
  const changedAt = Date.parse(input.changedAt);
  if (!Number.isFinite(changedAt)) return { allowed: true };
  const now = input.now ?? Date.now();
  const retryAt = changedAt + HANDLE_RENAME_COOLDOWN_MS;
  return now >= retryAt
    ? { allowed: true }
    : { allowed: false, retryAt: new Date(retryAt).toISOString() };
}

export type PublicHandleAlias = {
  handle: string;
  currentHandle: string;
  isCurrent: boolean;
};
