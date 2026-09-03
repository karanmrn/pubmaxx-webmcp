import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  sanitizeEvent,
  type AnalyticsEvent,
  type PlanningSource,
} from "@/lib/analyticsEvents";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const TOKEN_MAX_LENGTH = 2_000;

type VerifiedAnalyticsClaims = {
  v: typeof TOKEN_VERSION;
  eventId: string;
  name: AnalyticsEvent["name"];
  props: AnalyticsEvent["props"];
  issuedAt: number;
  expiresAt: number;
};

function canonicalEvent(event: AnalyticsEvent): AnalyticsEvent | null {
  const sanitized = sanitizeEvent(event.name, event.props);
  if (sanitized) {
    const props = Object.fromEntries(Object.entries(sanitized.props).sort(([left], [right]) => left.localeCompare(right)));
    return { name: sanitized.name, props };
  }

  // Compatibility only for the pre-handoff Plan creation response. Its client
  // event is now rejected by sanitizeEvent, so this token can never be ingested;
  // retaining deterministic minting keeps direct/manual Plan creation working
  // until L09 replaces this legacy response contract.
  if (event.name === "plan_accepted"
    && Object.keys(event.props).length === 2
    && Number.isInteger(event.props.stops)
    && typeof event.props.grounded === "boolean") {
    return {
      name: event.name,
      props: { grounded: event.props.grounded, stops: event.props.stops },
    };
  }
  return null;
}

function signature(encoded: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(`verified-analytics:v${TOKEN_VERSION}:${encoded}`).digest();
}

function eventId(subject: string, event: AnalyticsEvent, key: Buffer): string {
  const hex = createHmac("sha256", key)
    .update(`verified-analytics-event:${subject}:${event.name}:${JSON.stringify(event.props)}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function mintVerifiedAnalyticsToken(
  event: AnalyticsEvent,
  subject: string,
  occurredAt: string,
): string {
  const canonical = canonicalEvent(event);
  const issuedAt = Date.parse(occurredAt);
  if (!canonical || !subject || !Number.isFinite(issuedAt)) throw new Error("Verified analytics needs a canonical event and occurrence.");
  const key = trustedSigningKey();
  const claims: VerifiedAnalyticsClaims = {
    v: TOKEN_VERSION,
    eventId: eventId(subject, canonical, key),
    name: canonical.name,
    props: canonical.props,
    issuedAt,
    expiresAt: issuedAt + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, key).toString("base64url")}`;
}

export function verifyAnalyticsDeliveryToken(
  token: unknown,
  event: AnalyticsEvent,
  now = Date.now(),
): VerifiedAnalyticsClaims | null {
  if (typeof token !== "string" || !token || token.length > TOKEN_MAX_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const key = trustedSigningKey();
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0], key);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<VerifiedAnalyticsClaims>;
    const canonical = canonicalEvent(event);
    if (!canonical || claims.v !== TOKEN_VERSION || typeof claims.eventId !== "string") return null;
    if (claims.name !== canonical.name || JSON.stringify(claims.props) !== JSON.stringify(canonical.props)) return null;
    if (typeof claims.issuedAt !== "number" || !Number.isSafeInteger(claims.issuedAt)
      || typeof claims.expiresAt !== "number" || !Number.isSafeInteger(claims.expiresAt)) return null;
    if (claims.expiresAt !== claims.issuedAt + TOKEN_TTL_MS || now >= claims.expiresAt) return null;
    if (claims.issuedAt > now + 30_000) return null;
    if (!/^[0-9a-f-]{36}$/i.test(claims.eventId)) return null;
    return claims as VerifiedAnalyticsClaims;
  } catch {
    return null;
  }
}

export function analyticsDeliveryTokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function planLoopEventTokens(input: {
  planId: string;
  createdAt: string;
  stops: number;
  grounded: boolean;
}): { planAccepted: string; meaningfulCoreAction: string } {
  return {
    planAccepted: mintVerifiedAnalyticsToken(
      { name: "plan_accepted", props: { stops: input.stops, grounded: input.grounded } },
      `plan:${input.planId}`,
      input.createdAt,
    ),
    // Legacy direct/manual Plan creation is not the trusted three-Stop outcome.
    // Empty compatibility value keeps its response shape stable while making
    // the existing client condition fail closed until L09 emits the V2 token.
    meaningfulCoreAction: "",
  };
}

export function planDraftSavedEventToken(input: {
  planId: string;
  savedAt: string;
  source: PlanningSource;
}): string {
  return mintVerifiedAnalyticsToken(
    {
      name: "plan_draft_saved",
      props: {
        stops: 1,
        grounded: true,
        anchored: true,
        routeReady: false,
        source: input.source,
      },
    },
    `plan:${input.planId}:draft`,
    input.savedAt,
  );
}

export function planAcceptedEventTokens(input: {
  planId: string;
  acceptedAt: string;
  anchored: boolean;
  source: PlanningSource;
}): { planAccepted: string; meaningfulCoreAction: string } {
  return {
    planAccepted: mintVerifiedAnalyticsToken(
      {
        name: "plan_accepted",
        props: {
          stops: 3,
          grounded: true,
          anchored: input.anchored,
          routeReady: true,
          source: input.source,
        },
      },
      `plan:${input.planId}:route-ready`,
      input.acceptedAt,
    ),
    meaningfulCoreAction: mintVerifiedAnalyticsToken(
      { name: "meaningful_core_action", props: { action: "plan_accepted" } },
      `plan:${input.planId}:route-ready:meaningful`,
      input.acceptedAt,
    ),
  };
}

export function crewCommittedEventToken(input: {
  joinId: string;
  joinedAt: string;
  participants: number;
  routeReady: boolean;
}): string {
  return mintVerifiedAnalyticsToken(
    {
      name: "crew_committed",
      props: {
        source: "shared-plan",
        participants: input.participants,
        routeReady: input.routeReady,
      },
    },
    `join:${input.joinId}:crew-committed`,
    input.joinedAt,
  );
}

export function completionLoopEventTokens(input: {
  completionId: string;
  completedAt: string;
  ending: "food" | "get_home" | "keep_going";
}): { planCompleted: string; meaningfulCoreAction: string } {
  return {
    planCompleted: mintVerifiedAnalyticsToken(
      { name: "plan_completed", props: { ending: input.ending } },
      `completion:${input.completionId}`,
      input.completedAt,
    ),
    meaningfulCoreAction: mintVerifiedAnalyticsToken(
      { name: "meaningful_core_action", props: { action: "plan_completed" } },
      `completion:${input.completionId}:meaningful`,
      input.completedAt,
    ),
  };
}
