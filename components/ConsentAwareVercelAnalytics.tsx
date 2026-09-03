"use client";

import { useEffect } from "react";

import {
  Analytics,
  type BeforeSendEvent,
} from "@vercel/analytics/next";

import { analyticsCollectionAllowed, flushVerifiedAnalyticsOutbox } from "@/lib/analytics";

export function consentAwareBeforeSend(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  return analyticsCollectionAllowed() ? event : null;
}

export function shouldMountVercelAnalytics(
  environment: string | undefined,
  vercelDeployment?: string,
): boolean {
  return environment === "production" && vercelDeployment === "1";
}

/** Vercel pageviews remain disabled until explicit analytics consent. */
export default function ConsentAwareVercelAnalytics() {
  useEffect(() => { void flushVerifiedAnalyticsOutbox(); }, []);
  if (!shouldMountVercelAnalytics(process.env.NODE_ENV, process.env.VERCEL)) return null;
  return <Analytics beforeSend={consentAwareBeforeSend} />;
}
