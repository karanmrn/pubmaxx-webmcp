// Pure mapping from a raw web-vitals measurement to the privacy-safe props the
// `web_vital` analytics event carries. Kept out of the React component so every
// rule — value rounding, route-pattern derivation, and attribution-target
// sanitisation — is unit-tested without a DOM. The component only wires the
// web-vitals callbacks to this and to the consent-gated trackEvent.

import { toRoutePattern } from "@/lib/routePattern";

export const VITAL_METRICS = ["CLS", "FCP", "INP", "LCP", "TTFB"] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];

export const VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;
export type VitalRating = (typeof VITAL_RATINGS)[number];

const TARGET_MAX = 80;
// Structural CSS selectors only (tag/id/class/combinators). Deliberately
// excludes attribute VALUES, URLs, "@", and "?", so an attribution target can
// never smuggle a href, handle, query, or free text into telemetry.
const TARGET_SAFE = /^[a-zA-Z0-9 .#>~+_:()[\]*-]+$/;

/** Keep a web-vitals attribution selector only if it is a bounded, PII-free selector. */
export function sanitizeVitalTarget(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const capped = raw.trim().slice(0, TARGET_MAX);
  if (!capped) return null;
  if (capped.includes("@") || capped.includes("?") || /https?:/i.test(capped)) return null;
  return TARGET_SAFE.test(capped) ? capped : null;
}

/** CLS is a unitless ratio (3 dp); every other metric is milliseconds (integer). */
export function roundVitalValue(metric: VitalMetric, value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return metric === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
}

export type VitalEventProps = {
  metric: VitalMetric;
  value: number;
  rating: VitalRating;
  route: string;
  target?: string;
};

export function vitalEventProps(input: {
  metric: VitalMetric;
  value: number;
  rating: VitalRating;
  pathname: string;
  target?: string | null;
}): VitalEventProps {
  const target = sanitizeVitalTarget(input.target);
  return {
    metric: input.metric,
    value: roundVitalValue(input.metric, input.value),
    rating: input.rating,
    route: toRoutePattern(input.pathname),
    ...(target ? { target } : {}),
  };
}
