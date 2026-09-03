export const ANONYMOUS_ANALYTICS_STORAGE_KEY = "pubmaxx:analytics-id:v1";
export const ANALYTICS_CONSENT_STORAGE_KEY = "pubmaxx:analytics-consent:v1";

export type AnalyticsConsentDecision = "granted" | "denied";

const ANONYMOUS_ANALYTICS_ID = /^anon_[a-f0-9-]{16,64}$/;

export function isAnonymousAnalyticsId(value: unknown): value is string {
  return typeof value === "string" && ANONYMOUS_ANALYTICS_ID.test(value);
}

export function isAnalyticsConsentDecision(value: unknown): value is AnalyticsConsentDecision {
  return value === "granted" || value === "denied";
}
