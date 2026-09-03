"use client";

// Mounted only on the homepage (app/page.tsx) — the route the Capacitor
// remote-URL wrap always opens first and the only route the entry decision
// may rewrite. lib/entryDecision.ts owns the whole policy (deep links bypass,
// shell cold-starts land on /tonight, native first-run opens onboarding,
// browser visits keep the landing page); this component only snapshots the
// live context, applies the decision, and persists the first-run mark.
//
// Owner amendment (2026-07-21, amends #439): the decision fires only on the
// session's FIRST arrival at "/". We stamp the per-session flag
// (markSessionEntryConsumed) right after deciding, so a later in-app arrival at
// "/" (e.g. tapping the PUBMAXXING wordmark) reads the flag and stays on the
// landing page instead of bouncing back to /tonight. This component remounts on
// every client navigation to "/", so the second arrival re-runs decideEntry
// with sessionEntryConsumed already true and resolves to a "stay".
// Renders nothing; a no-op on the web and during SSR.

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  decideEntry,
  entryFirstRunHref,
  markSessionEntryConsumed,
  readEntryContext,
} from "@/lib/entryDecision";
import {
  clearNativeFirstRunHandoff,
  issueNativeFirstRunHandoff,
  markNativeFirstRunRouted,
} from "@/lib/nativeFirstRun";

export default function AppEntryRoute(): null {
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const decision = decideEntry(readEntryContext(pathname ?? "/"), entryFirstRunHref());
    // The cold-start decision has now run for this session; every later arrival
    // at "/" (a deliberate in-app home tap) must stay on the landing page.
    // Stamp before acting so a slow route transition can't leave it unset.
    markSessionEntryConsumed();
    if (decision.kind !== "route") {
      clearNativeFirstRunHandoff();
      return;
    }
    if (decision.reason === "native-first-run") {
      // Eligibility is carried out-of-URL and consumed by the guarded route.
      // Mark first so a slow transition can never double-fire on another boot.
      issueNativeFirstRunHandoff();
      markNativeFirstRunRouted();
    } else {
      clearNativeFirstRunHandoff();
    }
    router.replace(decision.href);
  }, [router, pathname]);

  return null;
}
