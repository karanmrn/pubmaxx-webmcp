// POST /api/events - self-owned, consent-gated product analytics ingest.
//
// The client beacon (lib/analytics.ts) posts a single registry-known event with
// allow-listed primitive props plus bounded screen, viewport, and original
// referrer context. This route re-validates both shapes (never trust the
// client), drops anything unknown or unsafe, and records the named event. When
// PostHog is configured, the provider receives the persistent consent-created
// device id, browser screen context, original referrer, request user agent, and
// client IP so standard browser/OS/device analytics and person-level retention
// work. Account identity, handles, free text, query-bearing app paths, and
// precise location are never attached.
//
// Events are also emitted as a structured server log line
// (`[pubmax-analytics] ...`) for release diagnosis. That owned log deliberately
// excludes the IP, user agent, and referrer. Both sinks fail soft:
// malformed input or a provider outage returns 204 and never breaks a journey.
// Verified loop outcomes add a response header so the bounded client outbox can
// retry without exposing transport failures to the product UI.
//
// This is a public, unauthenticated endpoint, so it also carries its own
// abuse guards: a per-hashed-IP rate limit (isEventsRateLimited) and a
// server-side DNT check, both below. PUBMAXX never stores or logs the raw IP:
// the limiter stores only its hash, while this consented request passes the raw
// value straight through to PostHog.

import { isIP } from "node:net";
import { sanitizeEvent } from "@/lib/analyticsEvents";
import { analyticsReferrerFromUrl } from "@/lib/analyticsPath";
import { analyticsSurfaceFromPath } from "@/lib/analyticsSurface";
import { isAnonymousAnalyticsId } from "@/lib/analyticsIdentity";
import { isEventsRateLimited } from "@/lib/eventsRateLimit";
import { capturePosthogEvent, isPosthogConfigured } from "@/lib/posthogServer";
import { clientIp } from "@/lib/supabase";
import { analyticsReceiptStore } from "@/lib/analyticsReceiptStore";
import { analyticsDeliveryTokenDigest, verifyAnalyticsDeliveryToken } from "@/lib/verifiedAnalytics.server";
import { isTrustedSigningKeyUnavailableError, trustedSigningKey } from "@/lib/trustedSigningKey.server";

export const runtime = "nodejs";

// Beacon payloads are tiny; anything larger is not one of ours.
const MAX_BODY_BYTES = 6_000;
const MAX_BROWSER_DIMENSION = 32_768;
const MAX_USER_AGENT_LENGTH = 1_000;

function noContent(delivery?: "delivered" | "retry" | "discard"): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      ...(delivery ? { "x-analytics-delivery": delivery } : {}),
    },
  });
}

function requiresVerifiedDelivery(name: string, props: Record<string, string | number | boolean>): boolean {
  return name === "plan_draft_saved"
    || name === "plan_accepted"
    || name === "crew_committed"
    || name === "plan_completed"
    || (name === "meaningful_core_action" && ["plan_accepted", "plan_completed"].includes(String(props.action)));
}

function safeDimension(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isInteger(value)
    && value > 0
    && value <= MAX_BROWSER_DIMENSION
    ? value
    : undefined;
}

function safeUserAgent(value: string | null): string | undefined {
  if (!value || value.length > MAX_USER_AGENT_LENGTH || /[\r\n]/.test(value)) return undefined;
  return value;
}

function safeReferrer(value: unknown, currentUrl: string): string | undefined {
  return analyticsReferrerFromUrl(value, currentUrl) ?? undefined;
}

function safeClientIp(request: Request): string | undefined {
  const value = clientIp(request);
  return isIP(value) ? value : undefined;
}

export async function POST(req: Request): Promise<Response> {
  try {
    // Server-side Do Not Track: the client beacon (lib/analytics.ts) already
    // checks navigator.doNotTrack before sending, but a direct POST (curl,
    // a script, a replay) bypasses a client-only check. Honor the header
    // itself so DNT is enforced at the trust boundary, not just in the UI.
    if (req.headers.get("dnt") === "1") return noContent();

    // Every bad-input path below returns 204, never 4xx/429 — same fail-soft
    // convention as the rest of this route. A 429 would (a) hand an attacker
    // a signal to back off and retry slower rather than just stop, and (b)
    // the client fire-and-forgets the beacon anyway, so there's no one home
    // to read a status code.
    if (await isEventsRateLimited(req)) return noContent();

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return noContent();

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return noContent();
    }
    if (!body || typeof body !== "object") return noContent();

    const { name, props, path, anonymousId, analyticsConsent, deliveryToken, context } = body as {
      name?: unknown;
      props?: unknown;
      path?: unknown;
      anonymousId?: unknown;
      analyticsConsent?: unknown;
      deliveryToken?: unknown;
      context?: unknown;
    };
    if (typeof name !== "string") return noContent();

    const event = sanitizeEvent(
      name,
      props && typeof props === "object" ? (props as Record<string, unknown>) : undefined,
    );
    if (!event) return noContent();
    // Consent is required for every destination, including the structured
    // release log. A direct POST cannot bypass the browser consent gate.
    if (analyticsConsent !== true || !isAnonymousAnalyticsId(anonymousId)) {
      return noContent();
    }

    // Coarse path only (own-origin pathname), no query, capped - never a URL
    // that could carry a token.
    const safePath = analyticsSurfaceFromPath(path);
    const browserContext = context && typeof context === "object"
      ? context as Record<string, unknown>
      : {};
    const verified = requiresVerifiedDelivery(event.name, event.props);
    if (verified) {
      try {
        trustedSigningKey();
      } catch (error) {
        // Configuration loss is retryable: do not tell the browser to discard
        // a token that may be valid again once the same secret is restored.
        if (isTrustedSigningKeyUnavailableError(error)) return noContent("retry");
        throw error;
      }
    }
    const delivery = verified ? verifyAnalyticsDeliveryToken(deliveryToken, event) : null;
    if (verified && !delivery) return noContent("discard");
    if (delivery) {
      const claim = await analyticsReceiptStore().claim({
        eventId: delivery.eventId,
        tokenDigest: analyticsDeliveryTokenDigest(String(deliveryToken)),
        eventName: event.name,
      });
      if (claim === "delivered") return noContent("delivered");
      if (claim !== "claimed") return noContent(claim === "conflict" ? "discard" : "retry");
    }

    // Structured, PII-free log line. Server owns the timestamp.
    console.log(
      `[pubmax-analytics] ${JSON.stringify({
        name: event.name,
        props: event.props,
        path: safePath,
        ts: new Date().toISOString(),
      })}`,
    );

    // Awaiting a short, bounded request keeps delivery reliable in serverless
    // runtimes. Ordinary events stay fire-and-forget; verified outcomes retain
    // their outbox item when the provider asks for a retry.
    const forwarded = await capturePosthogEvent({
      event,
      path: safePath,
      anonymousId,
      analyticsConsent,
      clientIp: safeClientIp(req),
      userAgent: safeUserAgent(req.headers.get("user-agent")),
      referrer: safeReferrer(browserContext.referrer, req.url),
      screenWidth: safeDimension(browserContext.screenWidth),
      screenHeight: safeDimension(browserContext.screenHeight),
      viewportWidth: safeDimension(browserContext.viewportWidth),
      viewportHeight: safeDimension(browserContext.viewportHeight),
      ...(delivery ? { insertId: delivery.eventId } : {}),
      ...(delivery ? { occurredAt: new Date(delivery.issuedAt).toISOString() } : {}),
    });

    if (delivery) {
      const providerDisabled = !isPosthogConfigured();
      if (!providerDisabled && !forwarded) return noContent("retry");
      if (!await analyticsReceiptStore().complete(delivery.eventId)) return noContent("retry");
      return noContent("delivered");
    }

    return noContent();
  } catch {
    return noContent();
  }
}
