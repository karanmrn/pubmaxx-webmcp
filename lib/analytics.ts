// Client-side event beacon (Wave D · D0). One entry point — trackEvent — that
// the whole app uses to record a self-owned, privacy-first signal. This
// replaces the earlier Vercel Analytics-backed rail (R3); the same closed set
// of ~10 named events those cycle metrics depend on now lives in the shared
// registry (lib/analyticsEvents.ts) instead of a third-party `track()` call,
// so every existing caller (badge_tap, booking_click, tour_complete, etc.)
// keeps working unchanged.
//
// Privacy-first: honours Do-Not-Track, sends only registry-known events with
// allow-listed primitive props (validated again here as defence in depth), and
// carries a stable pseudonymous identifier only after explicit analytics
// consent; without consent the server does not forward the event to PostHog.
// Ordinary events use sendBeacon/keepalive and stay fire-and-forget. Server-
// verified acceptance/completion outcomes use a bounded, consent-cleared local
// outbox and acknowledged keepalive fetch so lost responses can be retried
// safely against the durable dedupe receipt.

import {
  sanitizeEvent,
  type AnalyticsEventName,
  type AnalyticsProps,
  type WeeklyMeaningfulCoreAction,
} from "@/lib/analyticsEvents";
import {
  ANONYMOUS_ANALYTICS_STORAGE_KEY,
  ANALYTICS_CONSENT_STORAGE_KEY,
  isAnalyticsConsentDecision,
  isAnonymousAnalyticsId,
  type AnalyticsConsentDecision,
} from "@/lib/analyticsIdentity";
import {
  capturePosthogPageview,
  syncPosthogConsent,
} from "@/lib/posthogClient";
import { analyticsReferrerFromUrl } from "@/lib/analyticsPath";
import { discardBody } from "@/lib/responseBody";

const ENDPOINT = "/api/events";
const VERIFIED_OUTBOX_KEY = "pubmaxx:analytics-verified-outbox:v1";
const ANALYTICS_CONSENT_CHANGE_EVENT = "pubmaxx:analytics-consent";
let inMemoryAnonymousId: string | null = null;
let inMemoryConsentDecision: AnalyticsConsentDecision | null = null;
let inMemoryConsentIsFallback = false;
const inMemoryVerifiedOutbox = new Map<string, string>();
let verifiedFlush: Promise<void> | null = null;
let verifiedFlushAbort: AbortController | null = null;
let analyticsConsentEpoch = 0;
let analyticsStorageListenerWindow: Window | null = null;

type TrackEventOptions = { deliveryToken?: string };
type AnalyticsBrowserContext = {
  screenWidth?: number;
  screenHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  referrer?: string;
};

function abortVerifiedFlush(): void {
  analyticsConsentEpoch += 1;
  verifiedFlushAbort?.abort();
  verifiedFlushAbort = null;
  verifiedFlush = null;
}

function notifyAnalyticsConsentChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_CHANGE_EVENT));
  } catch {
    // Storage remains authoritative when Event is unavailable.
  }
}

function replaceInMemoryVerifiedOutbox(raw: string | null): void {
  inMemoryVerifiedOutbox.clear();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const row of parsed.slice(-20)) {
      if (!row || typeof row !== "object") continue;
      const token = (row as { token?: unknown }).token;
      const payload = (row as { payload?: unknown }).payload;
      if (typeof token === "string" && typeof payload === "string") {
        inMemoryVerifiedOutbox.set(token, payload);
      }
    }
  } catch { /* malformed cross-tab state is treated as an empty outbox */ }
}

function handleAnalyticsStorageChange(event: StorageEvent): void {
  if (event.key !== ANALYTICS_CONSENT_STORAGE_KEY && event.key !== VERIFIED_OUTBOX_KEY) return;
  abortVerifiedFlush();

  if (event.key === ANALYTICS_CONSENT_STORAGE_KEY) {
    inMemoryConsentDecision = isAnalyticsConsentDecision(event.newValue)
      ? event.newValue
      : null;
    inMemoryConsentIsFallback = false;
    if (inMemoryConsentDecision !== "granted") {
      inMemoryAnonymousId = null;
      inMemoryVerifiedOutbox.clear();
      syncPosthogConsent(false);
      notifyAnalyticsConsentChange();
      return;
    }
    const allowed = analyticsCollectionAllowed();
    syncPosthogConsent(allowed);
    if (allowed) {
      capturePosthogPageview(window.location.pathname, anonymousAnalyticsId());
    }
    void flushVerifiedAnalyticsOutbox();
    notifyAnalyticsConsentChange();
    return;
  }

  let consentGranted = false;
  try {
    consentGranted = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY) === "granted";
  } catch {
    consentGranted = inMemoryConsentDecision === "granted";
  }
  if (!consentGranted) {
    inMemoryVerifiedOutbox.clear();
    return;
  }
  replaceInMemoryVerifiedOutbox(event.newValue);
  void flushVerifiedAnalyticsOutbox();
}

function ensureAnalyticsStorageListener(): void {
  if (typeof window === "undefined"
    || analyticsStorageListenerWindow === window
    || typeof window.addEventListener !== "function") return;
  window.addEventListener("storage", handleAnalyticsStorageChange);
  analyticsStorageListenerWindow = window;
}

function persistedVerifiedOutbox(): Map<string, string> {
  const items = new Map(inMemoryVerifiedOutbox);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VERIFIED_OUTBOX_KEY) ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      for (const row of parsed.slice(-20)) {
        if (!row || typeof row !== "object") continue;
        const token = (row as { token?: unknown }).token;
        const payload = (row as { payload?: unknown }).payload;
        if (typeof token === "string" && typeof payload === "string") items.set(token, payload);
      }
    }
  } catch { /* in-memory retry still works for this page lifetime */ }
  return items;
}

function writeVerifiedOutbox(items: Map<string, string>): void {
  inMemoryVerifiedOutbox.clear();
  for (const [token, payload] of [...items.entries()].slice(-20)) inMemoryVerifiedOutbox.set(token, payload);
  try {
    window.localStorage.setItem(
      VERIFIED_OUTBOX_KEY,
      JSON.stringify([...inMemoryVerifiedOutbox].map(([token, payload]) => ({ token, payload }))),
    );
  } catch { /* in-memory queue remains */ }
}

function clearVerifiedOutbox(): void {
  inMemoryVerifiedOutbox.clear();
  try { window.localStorage.removeItem(VERIFIED_OUTBOX_KEY); } catch { /* best effort */ }
}

function removeVerifiedOutboxItem(token: string): void {
  const current = persistedVerifiedOutbox();
  current.delete(token);
  writeVerifiedOutbox(current);
}

export async function flushVerifiedAnalyticsOutbox(): Promise<void> {
  if (verifiedFlush) return verifiedFlush;
  ensureAnalyticsStorageListener();
  if (typeof window === "undefined" || !analyticsCollectionAllowed()) return;
  const epoch = analyticsConsentEpoch;
  const controller = new AbortController();
  verifiedFlushAbort = controller;
  const active = () => (
    epoch === analyticsConsentEpoch
    && !controller.signal.aborted
    && analyticsCollectionAllowed()
  );
  const run = (async () => {
    if (!active()) return;
    const items = persistedVerifiedOutbox();
    for (const [token, payload] of items) {
      if (!active()) return;
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
          signal: controller.signal,
        });
        // The delivery answer is a header. Nothing here reads the body, so let
        // it go rather than leaving the request open on every flush.
        discardBody(response);
        if (!active()) return;
        const status = response.headers.get("x-analytics-delivery");
        if (response.ok && (status === "delivered" || status === "discard")) {
          if (!active()) return;
          removeVerifiedOutboxItem(token);
        }
      } catch { /* retain for the next mount or event */ }
    }
  })();
  verifiedFlush = run;
  void run.finally(() => {
    if (verifiedFlush === run) verifiedFlush = null;
    if (verifiedFlushAbort === controller) verifiedFlushAbort = null;
  });
  return run;
}

function newAnonymousAnalyticsId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `anon_${random}`;
}

/**
 * Stable, pseudonymous keyless funnel id. It contains no account, handle,
 * contact, or location data and is never created during server rendering.
 */
export function anonymousAnalyticsId(): string | null {
  if (typeof window === "undefined") return null;
  ensureAnalyticsStorageListener();
  if (readAnalyticsConsentDecision() !== "granted") return null;
  if (inMemoryConsentIsFallback) {
    if (!inMemoryAnonymousId) inMemoryAnonymousId = newAnonymousAnalyticsId();
    return inMemoryAnonymousId;
  }
  try {
    const existing = window.localStorage.getItem(ANONYMOUS_ANALYTICS_STORAGE_KEY);
    if (isAnonymousAnalyticsId(existing)) {
      inMemoryAnonymousId = existing;
      return existing;
    }
    const created = newAnonymousAnalyticsId();
    window.localStorage.setItem(ANONYMOUS_ANALYTICS_STORAGE_KEY, created);
    inMemoryAnonymousId = created;
    return created;
  } catch {
    inMemoryConsentIsFallback = true;
    if (!inMemoryAnonymousId) inMemoryAnonymousId = newAnonymousAnalyticsId();
    return inMemoryAnonymousId;
  }
}

function readAnalyticsConsentDecision(): AnalyticsConsentDecision | null {
  if (typeof window === "undefined") return null;
  if (inMemoryConsentIsFallback) return inMemoryConsentDecision;
  try {
    const decision = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    inMemoryConsentDecision = isAnalyticsConsentDecision(decision) ? decision : null;
    return inMemoryConsentDecision;
  } catch {
    inMemoryConsentIsFallback = true;
    return inMemoryConsentDecision;
  }
}

export function analyticsConsentDecision(): AnalyticsConsentDecision | null {
  if (typeof window === "undefined") return null;
  ensureAnalyticsStorageListener();
  return readAnalyticsConsentDecision();
}

export function subscribeAnalyticsConsent(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  ensureAnalyticsStorageListener();
  const handler = () => onChange();
  window.addEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, handler);
  return () => {
    window.removeEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, handler);
  };
}

export function setAnalyticsConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  ensureAnalyticsStorageListener();
  // Every local or cross-tab consent transition invalidates snapshots captured
  // by an older flush. Epoch checks also protect against fetch implementations
  // that resolve after abort.
  abortVerifiedFlush();
  inMemoryConsentDecision = granted ? "granted" : "denied";
  try {
    if (granted) {
      window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "granted");
      void flushVerifiedAnalyticsOutbox();
    } else {
      window.localStorage.removeItem(ANONYMOUS_ANALYTICS_STORAGE_KEY);
      inMemoryAnonymousId = null;
      clearVerifiedOutbox();
      window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "denied");
    }
    inMemoryConsentIsFallback = false;
  } catch {
    inMemoryConsentIsFallback = true;
    if (!granted) {
      inMemoryAnonymousId = null;
      clearVerifiedOutbox();
    }
  }
  const allowed = analyticsCollectionAllowed();
  const anonymousId = allowed ? anonymousAnalyticsId() : null;
  syncPosthogConsent(allowed);
  if (allowed) {
    capturePosthogPageview(window.location.pathname, anonymousId);
  }
  notifyAnalyticsConsentChange();
}

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { doNotTrack?: string };
  const win = typeof window !== "undefined"
    ? (window as Window & { doNotTrack?: string })
    : undefined;
  const dnt = nav.doNotTrack ?? win?.doNotTrack;
  return dnt === "1" || dnt === "yes";
}

/**
 * One consent gate shared by product events and both pageview sinks.
 * It never creates an identifier and fails closed when browser storage is
 * unavailable unless the person explicitly granted consent in this session.
 */
export function analyticsCollectionAllowed(): boolean {
  if (typeof window === "undefined") return false;
  ensureAnalyticsStorageListener();
  if (doNotTrack()) return false;
  return readAnalyticsConsentDecision() === "granted";
}

function analyticsBrowserContext(): AnalyticsBrowserContext {
  const context: AnalyticsBrowserContext = {};
  const screenWidth = window.screen?.width;
  const screenHeight = window.screen?.height;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const referrer = window.document?.referrer;

  if (Number.isFinite(screenWidth)) context.screenWidth = screenWidth;
  if (Number.isFinite(screenHeight)) context.screenHeight = screenHeight;
  if (Number.isFinite(viewportWidth)) context.viewportWidth = viewportWidth;
  if (Number.isFinite(viewportHeight)) context.viewportHeight = viewportHeight;
  const safeReferrer = analyticsReferrerFromUrl(referrer, window.location.origin);
  if (safeReferrer) context.referrer = safeReferrer;
  return context;
}

/**
 * Record a product event. No-ops on the server, under Do-Not-Track, or for an
 * unknown/invalid event name. Never throws.
 */
export function trackEvent(
  name: AnalyticsEventName,
  props?: AnalyticsProps,
  options?: TrackEventOptions,
): void {
  try {
    if (typeof window === "undefined") return;
    if (!analyticsCollectionAllowed()) return;
    const event = sanitizeEvent(name, props);
    if (!event) return;

    const anonymousId = anonymousAnalyticsId();
    if (!anonymousId) return;
    const payload = JSON.stringify({
      name: event.name,
      props: event.props,
      path: window.location?.pathname ?? null,
      anonymousId,
      analyticsConsent: true,
      context: analyticsBrowserContext(),
      ...(options?.deliveryToken ? { deliveryToken: options.deliveryToken } : {}),
      ts: Date.now(),
    });

    if (options?.deliveryToken) {
      if (options.deliveryToken.length > 2_000) return;
      const items = persistedVerifiedOutbox();
      items.set(options.deliveryToken, payload);
      writeVerifiedOutbox(items);
      if (verifiedFlush) {
        void verifiedFlush.then(() => flushVerifiedAnalyticsOutbox());
      } else {
        void flushVerifiedAnalyticsOutbox();
      }
      return;
    }

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    // Fallback: keepalive fetch (still fire-and-forget).
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics must never break a flow */
  }
}

/**
 * Record one of the reviewed actions that qualifies a person for Weekly
 * Meaningful Pubmaxxers. Call this only beside the confirmed primary loop
 * event; keeping the roll-up separate makes the metric definition queryable
 * without treating route generation, claim steps, or passive views as value.
 */
export function trackMeaningfulCoreAction(action: WeeklyMeaningfulCoreAction, deliveryToken?: string): void {
  trackEvent("meaningful_core_action", { action }, deliveryToken ? { deliveryToken } : undefined);
}

// ---------------------------------------------------------------------------
// lane_to_plan provenance (R3)
//
// `lane_to_plan` must only count plan creations that genuinely started on a
// What's-On / Tonight lane surface — otherwise it is indistinguishable from
// `plan_created` and reports conversions that never involved a lane. Lane
// surfaces link to the composer with `?src=<lane source>` (W1 Tonight-surface
// work adds `?src=tonight-lane`); anything else yields null and the event
// stays silent. Honest zero > invented signal.

/**
 * Exact allowlist of canonical `src` tokens that count as a lane surface for
 * `lane_to_plan`. EXACT matching only — never prefix matching — so a crafted
 * link like `/plan?src=whats-on-jane.doe@example.com` can never push raw
 * query text (potential PII / free text) into telemetry. Grow this set as
 * lane surfaces ship (W1 Tonight lane, What's-On verticals).
 */
const LANE_SOURCES = new Set([
  "tonight-lane",
  "tonight-vibes",
  "landing-why",
  "whats-on-quiz",
  "whats-on-sport",
  "whats-on-deal",
  "whats-on-music",
]);

/**
 * Extract lane provenance from a location search string (e.g.
 * "?src=tonight-lane"). Returns the matched canonical token only when the
 * `src` value is EXACTLY one of the allowlisted lane sources; null otherwise
 * (missing, empty, unknown, or prefix-extended src → no event). Raw query
 * text is never forwarded into telemetry.
 */
export function laneSourceFromSearch(search: string): string | null {
  let src: string | null;
  try {
    src = new URLSearchParams(search).get("src");
  } catch {
    return null;
  }
  return src !== null && LANE_SOURCES.has(src) ? src : null;
}
