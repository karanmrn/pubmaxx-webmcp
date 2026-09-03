import type { Metadata } from "next";
import { notFound } from "next/navigation";

import SiteNav from "@/components/nav/SiteNav";
import MemoryReviewAnalytics from "@/components/plan/MemoryReviewAnalytics";
import RecapDetail from "@/components/plan/RecapDetail";
import { isPlanId } from "@/lib/plan";
import { buildPlanPrivacyPreview } from "@/lib/planPrivacy";
import { planStore } from "@/lib/planStore";

import "../../plan.css";
import "./recap.css";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const state = isPlanId(id) ? await planStore().get(id) : null;
  // §4.10: recap metadata is crawler-visible with no capability, so the title is
  // the privacy-safe preview — never the user title. The recap is noindex anyway.
  const area = state ? buildPlanPrivacyPreview(state).areaName : null;
  const safeTitle = area ? `A night out in ${area}` : "Recap";
  return {
    title: `${safeTitle} · Recap · PUBMAXXING`,
    // The recap is private to the crew by default — nothing here should be
    // indexed. The only public surface is an explicitly approved Night Story.
    robots: { index: false, follow: false },
  };
}

/**
 * §4.10: the recap server shell carries no user title, no route, no venue names,
 * and no pint detail. RecapDetail loads the full recap client-side from the
 * capability-gated GET /api/plans/[id]/recap, revealing it only to a member.
 */
export default async function PlanRecapPage({ params }: Props) {
  const { id } = await params;
  if (!isPlanId(id)) notFound();
  const state = await planStore().get(id);
  if (!state) notFound();

  return (
    <main id="main" className="recapPage">
      <MemoryReviewAnalytics />
      <SiteNav />
      <RecapDetail planId={id} />
    </main>
  );
}
