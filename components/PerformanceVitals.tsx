"use client";

import { useEffect } from "react";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals/attribution";

import { trackEvent } from "@/lib/analytics";
import { vitalEventProps, type VitalMetric, type VitalRating } from "@/lib/webVitals";

// Field-RUM sampling. 100% for now; lower this knob (a 0..1 fraction) if beacon
// volume becomes a concern. Sampled once per page load so a page contributes
// all of its vitals or none — never a partial, biased set.
const SAMPLE_RATE = 1;

type Attribution = {
  element?: string;
  interactionTarget?: string;
  largestShiftTarget?: string;
};

/** The metric's structural attribution selector — element/target only, never the URL. */
function attributionTarget(metric: Metric): string | null {
  const attribution = (metric as Metric & { attribution?: Attribution }).attribution;
  if (!attribution) return null;
  return (
    attribution.element ??
    attribution.interactionTarget ??
    attribution.largestShiftTarget ??
    null
  );
}

function report(metric: Metric): void {
  trackEvent(
    "web_vital",
    vitalEventProps({
      metric: metric.name as VitalMetric,
      value: metric.value,
      rating: metric.rating as VitalRating,
      pathname: typeof window !== "undefined" ? window.location.pathname : "/",
      target: attributionTarget(metric),
    }),
  );
}

/**
 * Real-user web-vitals beacon (LCP/INP/CLS/TTFB/FCP). Mounts unconditionally so
 * it measures the CURRENT product on every route (flags-off included), but each
 * emission rides the consent-gated trackEvent — a consent-denied or Do-Not-Track
 * session sends zero requests. The route is reported as a template (/plan/[id]),
 * attribution as a sanitised selector; no raw path, query string, venue id, or
 * URL ever leaves the device.
 */
export default function PerformanceVitals() {
  useEffect(() => {
    if (SAMPLE_RATE < 1 && Math.random() >= SAMPLE_RATE) return;
    onCLS(report);
    onFCP(report);
    onINP(report);
    onLCP(report);
    onTTFB(report);
  }, []);

  return null;
}
