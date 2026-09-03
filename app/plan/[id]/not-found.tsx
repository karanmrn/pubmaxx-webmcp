import type { Metadata } from "next";
import Link from "next/link";

import EmptyState from "@/components/EmptyState";
import SiteNav from "@/components/nav/SiteNav";

import "../plan.css";

// Branded not-found for /plan/[id] — rendered when the page calls notFound() on
// a plan that's unknown OR expired. This is a SHARED-LINK surface (someone was
// sent this link), so a bare white Next 404 reads as broken. Same honest
// empty-state pattern as the crawls/rounds surfaces: a short line, a grounded
// explainer, and one route on — start your own night.

export const metadata: Metadata = {
  title: "Plan · PUBMAXXING",
  robots: { index: false, follow: false },
};

export default function PlanNotFound(): React.JSX.Element {
  return (
    <main id="main" className="planPage planPage--composer">
      {/* Standard site navigation — a shared plan link is many people's first
          screen; it must route onward, not dead-end on a wordmark. SiteNav
          carries the brand, so the masthead keeps just the context line. */}
      <SiteNav />
      <header className="planPage__masthead">
        <span>Plan</span>
        <span>London · Tonight</span>
      </header>

      <EmptyState
        eyebrow="Plan"
        title="This plan has closed"
        body="The link's expired, or the plan was never here. Ask whoever sent it for a fresh link, or put your own night in order and send one back."
        action={
          <Link href="/plan" className="planPage__cta">
            Start your own plan
          </Link>
        }
      />
    </main>
  );
}
