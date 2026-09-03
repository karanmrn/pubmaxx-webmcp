import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ActivePlanMarker from "@/components/plan/ActivePlanMarker";
import NightCrawlMode from "@/components/plan/NightCrawlMode";
import PlanInviteOpened from "@/components/plan/PlanInviteOpened";
import PlanCrew from "@/components/plan/PlanCrew";
import PlanInviteNextStep from "@/components/plan/PlanInviteNextStep";
import CompletedPlanUsualLot from "@/components/plan/CompletedPlanUsualLot";
import LastCrewInvite from "@/components/plan/LastCrewInvite";
import SiteNav from "@/components/nav/SiteNav";
import PlanSummary from "@/components/plan/PlanSummary";
import PlanVibe from "@/components/plan/PlanVibe";
import type { PlanState } from "@/lib/plan";
import { buildPlanPrivacyPreview, type PlanPrivacyPreviewDTO } from "@/lib/planPrivacy";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planStore } from "@/lib/planStore";
import { buildPlanInviteShareText } from "@/lib/shareArtifacts";
import { shareVibeSlug, VIBE_SLUGS } from "@/lib/vibeChips";
import type { VibeTally } from "@/lib/vibeTally";

import "../plan.css";

/** A safe, non-leaking headline for anonymous surfaces — never the user title. */
function safePlanTitle(preview: PlanPrivacyPreviewDTO): string {
  return preview.areaName ? `Your night out in ${preview.areaName}` : "Your night out";
}

/** Preview-safe invite text: area + stop count + time, never the title or venues. */
function previewShareText(preview: PlanPrivacyPreviewDTO): string {
  return buildPlanInviteShareText({
    title: preview.areaName ? `a night out in ${preview.areaName}` : "a night out",
    stopCount: preview.stopCount,
    startClock: preview.startLabel === "Time to be confirmed" ? null : preview.startLabel,
  });
}

/**
 * §4.10: client components receive no route. NightCrawlMode still takes a
 * PlanState shape, so hand it a redacted one — safe title, no stops, no crew,
 * no context — and let its own capability-gated mount fetch upgrade a member.
 */
function redactedInitialState(state: PlanState, safeTitle: string): PlanState {
  return {
    plan: { ...state.plan, title: safeTitle },
    stops: [],
    crew: [],
    context: null,
    actions: [],
    ending: state.ending ?? null,
  };
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Crew vibe tally, fail-soft: the pre-migration 503 window (or any store
// error) reads as "no votes yet" and the page renders exactly as before.
async function readVibeTally(id: string): Promise<VibeTally | null> {
  try {
    const result = await planCollaborationStore().vibeTally(id);
    return result.ok ? result.tally : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const state = await planStore().get(id);
  if (!state) return { title: "Plan not found · PUBMAXXING" };
  // Vibe stamp on the unfurl (share loop, issue #438): a valid ?vibe= on the
  // shared link pins the stamp the sharer saw; otherwise the crew's live top
  // vibe stamps the card; otherwise the base card. Slugs are the locked
  // public contract in lib/vibeChips — anything else is dropped, not echoed.
  const tally = await readVibeTally(id);
  // §4.10: metadata + Open Graph are crawler-visible with no capability, so the
  // title and description are the privacy-safe preview — never the user title or
  // the venue route.
  const preview = buildPlanPrivacyPreview(state, tally);
  const safeTitle = safePlanTitle(preview);
  const description = previewShareText(preview);
  const vibe = shareVibeSlug(query.vibe, tally?.top ?? null);
  const card = `/api/plan-card?id=${encodeURIComponent(id)}${vibe ? `&vibe=${encodeURIComponent(vibe)}` : ""}`;
  return {
    title: `${safeTitle} · PUBMAXXING`,
    description,
    openGraph: {
      title: safeTitle,
      description,
      type: "website",
      url: `/plan/${id}`,
      images: [{ url: card, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: safeTitle, description, images: [card] },
  };
}

const ENDING_LABEL: Record<"food" | "get_home" | "keep_going", string> = {
  food: "found food after",
  get_home: "headed home",
  keep_going: "kept it going",
};

export default async function PlanPage({ params }: Props) {
  const { id } = await params;
  const state = await planStore().get(id);
  if (!state) notFound();
  // Crew vibe (share loop): the picker's server-rendered starting tally, and
  // the top slug that stamps the invite URL. Both fail soft to "no votes".
  const vibeTally = await readVibeTally(id);
  const topVibeSlug = vibeTally?.top ? VIBE_SLUGS[vibeTally.top] : null;
  // §4.10: the page's server HTML/RSC carries ONLY this preview — no venue
  // route, no crew list, no user title. Members upgrade to the full route
  // client-side via the capability-gated /api/plans/[id] inside each component.
  const preview = buildPlanPrivacyPreview(state, vibeTally);
  const safeTitle = safePlanTitle(preview);
  const shareText = previewShareText(preview);
  // A finished night must not still read like it's about to happen. Reflect the
  // server's own completion state so re-opening the plan the morning after
  // acknowledges the night and points onward to the recap, instead of stopping.
  const completed = state.plan.status === "completed" || Boolean(state.ending);
  const endingLabel = state.ending ? ENDING_LABEL[state.ending] : null;

  return (
    <main id="main" className="planPage">
      {/* Marks this plan as "on tonight" so the shell's Night Mode card can
          follow it across screens (client-only pointer, no backend). */}
      <ActivePlanMarker id={id} startTime={state.plan.startTime} />
      <PlanInviteOpened planId={id} />
      {/* Standard site navigation — a shared plan link is many people's first
          screen; it must route onward, not dead-end on a wordmark. SiteNav
          carries the brand, so the masthead keeps just the plan actions. */}
      <SiteNav />
      <header className="planPage__masthead">
        <span>Your plan</span>
        <Link href="/plan">Make another plan</Link>
      </header>
      <section className="planPage__hero">
        <p className="planPage__eyebrow">{completed ? "That was the night" : "Your night is sorted"}</p>
        <h1>{safeTitle}</h1>
        {completed ? (
          <p>
            {preview.stopCount} {preview.stopCount === 1 ? "pub" : "pubs"}
            {endingLabel ? `, and you ${endingLabel}` : ""}. Your private recap lives in{" "}
            <Link href="/u/you#night-memories">your Memories</Link>. Nothing is shared until you approve it.
          </p>
        ) : (
          <p>
            {preview.stopCount} {preview.stopCount === 1 ? "pub" : "pubs"}, one link, zero account walls.{" "}
            <a href="#share">Next: send this to the group</a>.
          </p>
        )}
      </section>
      {/* Night-crawl mode (U7): while this plan's night is on, it becomes the
          default full-screen surface on mobile and offers an inline entry
          otherwise. Client-only gating, no new route. */}
      {!completed ? <NightCrawlMode planId={id} initialState={redactedInitialState(state, safeTitle)} /> : null}
      {completed ? <CompletedPlanUsualLot /> : null}
      <div className="planPage__grid">
        <PlanSummary planId={id} initialPreview={preview} vibeTally={vibeTally} />
        <aside className="planPage__side">
          {!completed ? (
            <section className="planShare" aria-labelledby="plan-share-title">
              <p className="planPage__eyebrow">Send the invite</p>
              <h2 id="plan-share-title">Get everyone on the same page</h2>
              <p>WhatsApp the night link, or copy the invite. Mates tap “I’m in” with a name.</p>
              <PlanInviteNextStep
                planId={id}
                title={safeTitle}
                text={shareText}
                initialVibeSlug={topVibeSlug}
              />
              <LastCrewInvite planId={id} planTitle={safeTitle} />
            </section>
          ) : null}
          <PlanCrew planId={id} hostName={preview.hostDisplayName} />
          <PlanVibe planId={id} initialTally={vibeTally} />
        </aside>
      </div>
    </main>
  );
}
