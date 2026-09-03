import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SocialCrewListCursorPosition } from "@/lib/socialCrewProjection.server";

const CURSOR_VERSION = 1;
const CURSOR_LANE = "member";
const MAX_CURSOR_LENGTH = 1_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const CURSOR_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/;

type SocialCrewMemberCursorPayload = {
  v: 1;
  lane: "member";
  joinedAt: string;
  memberId: string;
};

export type SocialCrewCursorEnvelope = {
  encoded: string;
  signature: Buffer;
};

export class SocialCrewCursorInvalidError extends Error {
  constructor() {
    super("Social Crew page is not valid.");
    this.name = "SocialCrewCursorInvalidError";
  }
}

function invalid(): never {
  throw new SocialCrewCursorInvalidError();
}

function canonicalBase64url(value: string): Buffer {
  if (!BASE64URL_RE.test(value)) return invalid();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    return invalid();
  }
  return decoded;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = CURSOR_TIMESTAMP_RE.exec(value);
  if (!match) return false;
  const millisecondTimestamp = `${match[1]}.${match[2]!.slice(0, 3)}Z`;
  const epochMilliseconds = Date.parse(millisecondTimestamp);
  return Number.isFinite(epochMilliseconds) &&
    new Date(epochMilliseconds).toISOString() === millisecondTimestamp;
}

function exactPayload(value: unknown): SocialCrewMemberCursorPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 4 ||
    !["v", "lane", "joinedAt", "memberId"].every((key) => keys.includes(key)) ||
    candidate.v !== CURSOR_VERSION ||
    candidate.lane !== CURSOR_LANE ||
    !canonicalTimestamp(candidate.joinedAt) ||
    typeof candidate.memberId !== "string" ||
    !UUID_RE.test(candidate.memberId)
  ) {
    return invalid();
  }
  return {
    v: CURSOR_VERSION,
    lane: CURSOR_LANE,
    joinedAt: candidate.joinedAt,
    memberId: candidate.memberId,
  };
}

function signature(
  encoded: string,
  viewerProfileId: string,
  signingKey: Buffer,
): Buffer {
  return createHmac("sha256", signingKey)
    .update(`social-crew-member-cursor:v1:${viewerProfileId}:${encoded}`)
    .digest();
}

export function readSocialCrewCursorEnvelope(
  raw: unknown,
): SocialCrewCursorEnvelope {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) {
    return invalid();
  }
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return invalid();
  canonicalBase64url(parts[0]);
  const suppliedSignature = canonicalBase64url(parts[1]);
  if (suppliedSignature.length !== 32) return invalid();
  return { encoded: parts[0], signature: suppliedSignature };
}

export function decodeSocialCrewMemberCursor(
  envelope: SocialCrewCursorEnvelope,
  viewerProfileId: string,
  signingKey: Buffer,
): SocialCrewListCursorPosition {
  const expectedSignature = signature(
    envelope.encoded,
    viewerProfileId,
    signingKey,
  );
  if (
    envelope.signature.length !== expectedSignature.length ||
    !timingSafeEqual(envelope.signature, expectedSignature)
  ) {
    return invalid();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(envelope.encoded, "base64url").toString("utf8"),
    );
  } catch {
    return invalid();
  }
  const payload = exactPayload(parsed);
  const canonicalEncoded = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
  if (canonicalEncoded !== envelope.encoded) return invalid();
  return { joinedAt: payload.joinedAt, memberId: payload.memberId };
}

export function encodeSocialCrewMemberCursor(
  position: SocialCrewListCursorPosition,
  viewerProfileId: string,
  signingKey: Buffer,
): string {
  const payload = exactPayload({
    v: CURSOR_VERSION,
    lane: CURSOR_LANE,
    joinedAt: position.joinedAt,
    memberId: position.memberId,
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${signature(encoded, viewerProfileId, signingKey).toString("base64url")}`;
}
