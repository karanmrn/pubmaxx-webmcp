import type {
  CaptureResult,
  PostHogConfig,
} from "posthog-js";
import {
  ANONYMOUS_ANALYTICS_STORAGE_KEY,
  isAnonymousAnalyticsId,
} from "@/lib/analyticsIdentity";
import {
  analyticsPageviewSurfaceFromPath,
  analyticsReferrerFromUrl,
  analyticsUrlWithoutQuery,
} from "@/lib/analyticsPath";

const SAFE_EXCEPTION_TYPES = new Set([
  "AggregateError",
  "DOMException",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
const STANDARD_BROWSER_PROPERTIES = new Set([
  "token",
  "distinct_id",
  "$device_id",
  "$browser",
  "$browser_version",
  "$browser_language",
  "$browser_language_prefix",
  "$os",
  "$os_version",
  "$device",
  "$device_type",
  "$raw_user_agent",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$timezone",
  "$timezone_offset",
  "$current_url",
  "$host",
  "$pathname",
  "$referrer",
  "$referring_domain",
  "$initial_referrer",
  "$initial_referring_domain",
  "$lib",
  "$lib_version",
  "$insert_id",
  "$time",
  "$session_id",
  "$window_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "dclid",
  "gclid",
  "gad_source",
  "gbraid",
  "wbraid",
  "msclkid",
  "fbclid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "mc_cid",
  "igshid",
]);
const WEB_VITAL_METRICS = ["CLS", "FCP", "INP", "LCP"] as const;
const WEB_VITAL_RATINGS = new Set(["good", "needs-improvement", "poor"]);
type PostHogClient = (typeof import("posthog-js"))["default"];
type PendingPageview = {
  pathname: string;
  anonymousId: string;
};

const MAX_PENDING_PAGEVIEWS = 32;
let client: PostHogClient | null = null;
let clientLoad: Promise<PostHogClient | null> | null = null;
let consentRevision = 0;
let initialized = false;
let consentAllowedNow = false;
let captureEnabled = false;
const pendingPageviews: PendingPageview[] = [];
let lastObservedPageviewPathname: string | null = null;

function safeExceptionType(value: unknown): string {
  return typeof value === "string" && SAFE_EXCEPTION_TYPES.has(value)
    ? value
    : "Error";
}

/**
 * The coarse surface a crash happened on, in the closed pageview vocabulary.
 * Falls back to the current URL's path when the SDK did not attach $pathname.
 */
function exceptionSurface(properties: CaptureResult["properties"]): string | null {
  const fromPathname = analyticsPageviewSurfaceFromPath(properties.$pathname);
  if (fromPathname) return fromPathname;
  const currentUrl = analyticsUrlWithoutQuery(properties.$current_url);
  if (!currentUrl) return null;
  try {
    return analyticsPageviewSurfaceFromPath(new URL(currentUrl).pathname);
  } catch {
    return null;
  }
}

/**
 * Error tracking fingerprints a crash on its type and message, so a constant
 * message collapses every crash of one JS type into a single issue that can
 * never be told apart. The message stays redacted, and carries the coarse
 * surface instead: two crashes on different surfaces stay separate issues,
 * and no user text, URL or stack frame leaves the browser to do it.
 */
function redactedExceptionValue(surface: string | null): string {
  return surface ? `Redacted (${surface})` : "Redacted";
}

function standardBrowserProperties(
  properties: CaptureResult["properties"],
  pathname?: string,
): CaptureResult["properties"] {
  const standard = Object.fromEntries(
    Object.entries(properties).filter(([name]) =>
      STANDARD_BROWSER_PROPERTIES.has(name)),
  );
  for (const metric of WEB_VITAL_METRICS) {
    const valueKey = `$web_vitals_${metric}_value`;
    const eventKey = `$web_vitals_${metric}_event`;
    const value = properties[valueKey];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    standard[valueKey] = value;

    const rawEvent = properties[eventKey];
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) continue;
    const event = rawEvent as Record<string, unknown>;
    if (
      event.name !== metric
      || event.value !== value
      || typeof event.rating !== "string"
      || !WEB_VITAL_RATINGS.has(event.rating)
    ) continue;
    standard[eventKey] = {
      name: metric,
      value,
      rating: event.rating,
    };
  }
  const currentUrl = analyticsUrlWithoutQuery(properties.$current_url);
  if (pathname) {
    standard.$pathname = pathname;
    if (currentUrl) {
      standard.$current_url = new URL(pathname, currentUrl).toString();
    } else {
      delete standard.$current_url;
    }
  }
  for (const name of ["$referrer", "$initial_referrer"] as const) {
    const url = analyticsReferrerFromUrl(properties[name], currentUrl);
    if (url) standard[name] = url;
    else delete standard[name];
  }
  return standard;
}

function resolvePosthogDeviceId(generatedId: string): string {
  if (typeof window === "undefined") return generatedId;
  try {
    const storedId = window.localStorage.getItem(ANONYMOUS_ANALYTICS_STORAGE_KEY);
    return isAnonymousAnalyticsId(storedId) ? storedId : generatedId;
  } catch {
    return generatedId;
  }
}

/**
 * Browser SDK owns explicit pageviews, standard web vitals, and scrubbed
 * exception counts. Its before-send hook is a closed system-event registry:
 * DOM autocapture and custom product events are rejected here.
 *
 * Product events stay on trackEvent -> /api/events, where registry, consent,
 * and DNT are rechecked.
 */
export function sanitizePosthogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;

  if (event.event === "$pageview") {
    const distinctId = event.properties.$pubmaxx_anonymous_id;
    const rawPathname = event.properties.$pathname;
    const pathname = safeBrowserPageviewPath(rawPathname)
      ? analyticsPageviewSurfaceFromPath(rawPathname)
      : null;
    if (!isAnonymousAnalyticsId(distinctId) || !pathname) return null;
    if (event.properties.distinct_id !== distinctId) return null;

    return {
      uuid: event.uuid,
      event: "$pageview",
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      properties: {
        ...standardBrowserProperties(event.properties, pathname),
        distinct_id: distinctId,
        $device_id: distinctId,
        $pathname: pathname,
      },
    };
  }

  if (event.event === "$web_vitals") {
    const distinctId = event.properties.distinct_id;
    const rawPathname = event.properties.$pathname;
    const pathname = typeof rawPathname === "string"
      ? analyticsPageviewSurfaceFromPath(rawPathname)
      : null;
    if (!isAnonymousAnalyticsId(distinctId) || !pathname) return null;
    return {
      uuid: event.uuid,
      event: "$web_vitals",
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      properties: standardBrowserProperties(event.properties, pathname),
    };
  }

  if (event.event !== "$exception") return null;

  const distinctId = event.properties.distinct_id;
  if (!isAnonymousAnalyticsId(distinctId)) return null;

  const rawExceptions = event.properties.$exception_list;
  if (!Array.isArray(rawExceptions) || rawExceptions.length === 0) return null;

  const surface = exceptionSurface(event.properties);
  const exceptionList = rawExceptions.slice(0, 8).map((exception) => ({
    type: safeExceptionType(
      exception && typeof exception === "object"
        ? (exception as Record<string, unknown>).type
        : undefined,
    ),
    value: redactedExceptionValue(surface),
  }));
  const properties = standardBrowserProperties(event.properties);
  delete properties.$current_url;
  delete properties.$pathname;
  delete properties.$referrer;
  delete properties.$initial_referrer;
  if (surface) properties.$pathname = surface;

  return {
    uuid: event.uuid,
    event: "$exception",
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    properties: {
      ...properties,
      distinct_id: distinctId,
      $device_id: distinctId,
      $exception_list: exceptionList,
    },
  };
}

function safeBrowserPageviewPath(value: unknown): value is string {
  return (
    typeof value === "string"
    && !value.includes("?")
    && !value.includes("#")
  );
}

export const posthogBrowserConfig = {
  api_host: "/ingest",
  ui_host: "https://eu.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: true,
  autocapture: false,
  rageclick: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_performance: true,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_external_dependency_loading: false,
  request_batching: false,
  persistence: "localStorage+cookie",
  save_campaign_params: true,
  save_referrer: true,
  get_device_id: resolvePosthogDeviceId,
  opt_in_site_apps: false,
  person_profiles: "always",
  advanced_disable_flags: true,
  opt_out_capturing_by_default: true,
  opt_out_persistence_by_default: true,
  // PostHog drops HeadlessChrome before before_send. Production browser tests
  // use an inert public token and opt out of that SDK filter so they can prove
  // the real transport path. Production builds never set this flag.
  ...(process.env.NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT === "1"
    ? { opt_out_useragent_filter: true }
    : {}),
  respect_dnt: true,
  before_send: sanitizePosthogEvent,
} satisfies Partial<PostHogConfig>;

function loadPosthogClient(): Promise<PostHogClient | null> {
  if (client) return Promise.resolve(client);
  if (!clientLoad) {
    clientLoad = import("posthog-js")
      .then(({ default: loadedClient }) => {
        client = loadedClient;
        return loadedClient;
      })
      .catch(() => null)
      .finally(() => {
        clientLoad = null;
      });
  }
  return clientLoad;
}

export function syncPosthogConsent(consentAllowed: boolean): void {
  const revision = ++consentRevision;
  consentAllowedNow = consentAllowed;
  captureEnabled = false;
  if (!consentAllowed) {
    pendingPageviews.length = 0;
    lastObservedPageviewPathname = null;
    if (initialized) client?.opt_out_capturing();
    return;
  }

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return;

  void loadPosthogClient().then((loadedClient) => {
    if (!loadedClient || revision !== consentRevision) return;
    if (!initialized) {
      loadedClient.init(token, posthogBrowserConfig);
      initialized = true;
    } else {
      // opt-out clears PostHog persistence. Re-seed from the newly created
      // consent-scoped ID before capture resumes so SDK Web Vitals and named
      // events keep one device identity after a later opt-in.
      loadedClient.reset(true);
    }
    if (revision !== consentRevision) {
      loadedClient.opt_out_capturing();
      return;
    }
    loadedClient.opt_in_capturing({ captureEventName: false });
    if (revision !== consentRevision) {
      loadedClient.opt_out_capturing();
      return;
    }
    captureEnabled = true;
    const pageviews = pendingPageviews.splice(0);
    for (const pageview of pageviews) {
      loadedClient.capture("$pageview", {
        $pathname: pageview.pathname,
        $pubmaxx_anonymous_id: pageview.anonymousId,
      });
    }
  }).catch(() => undefined);
}

export function capturePosthogPageview(pathname: string, anonymousId: string | null): void {
  if (
    !safeBrowserPageviewPath(pathname)
    || !isAnonymousAnalyticsId(anonymousId)
    || !consentAllowedNow
  ) return;

  if (pathname === lastObservedPageviewPathname) return;
  lastObservedPageviewPathname = pathname;

  const analyticsSurface = analyticsPageviewSurfaceFromPath(pathname);
  if (!analyticsSurface) return;

  if (!initialized || !client || !captureEnabled) {
    if (pendingPageviews.length >= MAX_PENDING_PAGEVIEWS) {
      pendingPageviews.splice(1, 1);
    }
    pendingPageviews.push({
      pathname: analyticsSurface,
      anonymousId,
    });
    return;
  }

  client.capture("$pageview", {
    $pathname: analyticsSurface,
    $pubmaxx_anonymous_id: anonymousId,
  });
}

export function initializePosthog(consentAllowed: boolean): void {
  syncPosthogConsent(consentAllowed);
}
