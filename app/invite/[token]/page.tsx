import type { Metadata } from "next";
import Link from "next/link";

import RouteThumbnail from "@/app/crawls/RouteThumbnail";
import InvitePageView from "@/components/plan/InvitePageView";
import PlanInviteRsvp from "@/components/plan/PlanInviteRsvp";
import type { PlanInviteRsvpSummary } from "@/lib/planInvite";
import { reactionStore, rsvpStore } from "@/lib/planInviteRsvpStore";
import { PLAN_STOP_MAX, type PlanStopDTO } from "@/lib/plan";
import { planStateResult, resolvePlanIdByInviteToken } from "@/lib/planStore";
import type { ReactionSummary } from "@/lib/reactions";
import {
  formatPlanInviteSpendBand,
  planInviteSpendBandFromListedPrices,
  type PlanInviteSpendBand,
} from "@/lib/shareArtifacts";
import { formatPrice } from "@/lib/venues";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { planAlcoholOptionalInviteLine } from "@/lib/planAlcoholOptional";

import "./invite.css";

// The public invite page (Task: plan-invite-page): the warm, Partiful-style
// card a Plan's invite link opens on. A server component so the crawler gets
// real OG tags and the card renders with no client fetch — the token resolves
// to a plan id through a deliberate, token-scoped seam
// (resolvePlanIdByInviteToken), never the plan's own guarded RLS row. Social
// proof (RSVP + reactions) mounts as a client island below the static card.
//
// Handle-free RSVP write and host-only removal already live at
// app/api/invite/[token]/rsvp/route.ts; this page only reads.
//
// Scope: this page supports classic (non-Crew) Plans only. planStateResult
// resolves a Crew-bound (Social-owned) plan as { plan: null } by design — the
// same boundary other public-read surfaces already hold — so a Crew plan's
// invite token reads as "not valid" rather than leaking that it exists.

type PageProps = {
  params: Promise<{ token: string }>;
};

type InviteStop = {
  venueId: string;
  venueName: string;
  position: number;
  price: string | null;
  priceGbp: number | null;
  coordinates: [number, number] | null;
};

// The card may be opened days before the event, so it needs a date on it, not
// just a time — unlike lib/invitePrivacyPreview.ts's pre-acceptance viewer,
// which already has date context from the surface it sits inside.
function formatStartLabel(startTime: string): string {
  const parsed = Date.parse(startTime);
  if (!Number.isFinite(parsed)) return "Time to be confirmed";
  const date = new Date(parsed);
  const day = date.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}

// Bounded to PLAN_STOP_MAX (a Plan never exceeds it, but the slice is a
// defensive floor). A venue lookup that fails ("unavailable") keeps the stop's
// own trusted name from the Plan record but drops its price and route point
// rather than guessing either.
async function loadStops(stops: PlanStopDTO[]): Promise<InviteStop[]> {
  const ordered = [...stops].sort((a, b) => a.position - b.position).slice(0, PLAN_STOP_MAX);
  const details = await Promise.all(ordered.map((stop) => lookupVenueDetail(stop.venueId)));
  return ordered.map((stop, index) => {
    const detail = details[index];
    const venue = detail.status === "found" ? detail.venue : null;
    return {
      venueId: stop.venueId,
      venueName: stop.venueName,
      position: stop.position,
      price: venue && typeof venue.cheapestPrice === "number" ? formatPrice(venue.cheapestPrice) : null,
      priceGbp: venue && typeof venue.cheapestPrice === "number" ? venue.cheapestPrice : null,
      coordinates: venue ? ([venue.longitude, venue.latitude] as [number, number]) : null,
    };
  });
}

const EMPTY_SUMMARIES: { rsvp: PlanInviteRsvpSummary; reactions: ReactionSummary } = {
  rsvp: { counts: { going: 0, maybe: 0 }, guests: [] },
  reactions: { counts: {}, mine: [] },
};

// Never blocks the card: an RSVP/reaction read failure falls back to an honest
// zero state rather than taking the whole invite down.
async function loadInitialSummaries(
  planId: string,
): Promise<{ rsvp: PlanInviteRsvpSummary; reactions: ReactionSummary }> {
  try {
    const [rsvp, reactions] = await Promise.all([
      rsvpStore().summarize(planId),
      // Empty submitter hash: this is the server-rendered aggregate read, not
      // one guest's device — "mine" stays empty until the client island fetches
      // with the real device id.
      reactionStore().summarize(planId, ""),
    ]);
    return { rsvp, reactions };
  } catch {
    return EMPTY_SUMMARIES;
  }
}

function inviteSpendBand(stops: readonly InviteStop[]): PlanInviteSpendBand | null {
  return planInviteSpendBandFromListedPrices(stops.map((stop) => stop.priceGbp));
}

function inviteDescription(
  startLabel: string,
  stopCount: number,
  spendBand: PlanInviteSpendBand | null,
): string {
  const stopLabel = `${stopCount} ${stopCount === 1 ? "stop" : "stops"}`;
  const detail = spendBand
    ? `${startLabel}. ${stopLabel} · ${formatPlanInviteSpendBand(spendBand)}`
    : `${startLabel}. ${stopLabel}`;
  return `${detail} on PUBMAXX.`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const lookup = await resolvePlanIdByInviteToken(token);
  const planId = lookup.ok ? lookup.planId : null;
  if (!planId) {
    return {
      title: "This invite link isn't valid",
      description: "This PUBMAXX invite couldn't be found.",
    };
  }

  const stateResult = await planStateResult(planId);
  const state = stateResult.ok ? stateResult.plan : null;
  if (!state) {
    return {
      title: "This invite link isn't valid",
      description: "This PUBMAXX invite couldn't be found.",
    };
  }

  const hostHandle = state.crew[0]?.name || "Your host";
  const startLabel = formatStartLabel(state.plan.startTime);
  const stopCount = state.stops.length;
  const stops = await loadStops(state.stops);
  const spendBand = inviteSpendBand(stops);
  const title = `${state.plan.title} · hosted by ${hostHandle}`;
  const description = inviteDescription(startLabel, stopCount, spendBand);

  // opengraph-image.tsx sits beside this route, so Next auto-attaches it.
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/invite/${token}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

// ── Empty states ─────────────────────────────────────────────────────────────
function InviteNotFound() {
  return (
    <main id="main" className="invite invite--empty">
      <div className="invite__emptyCard">
        <Link className="invite__home" href="/">
          PUBMAXXING
        </Link>
        <p className="invite__eyebrow">Invite</p>
        <h1 className="invite__emptyTitle">This invite link isn&rsquo;t valid</h1>
        <p className="invite__emptyBody">It may have been removed, or the link is wrong.</p>
        <Link className="invite__primary" href="/">
          Go to PUBMAXX
        </Link>
      </div>
    </main>
  );
}

function InviteUnavailable() {
  return (
    <main id="main" className="invite invite--empty">
      <div className="invite__emptyCard">
        <Link className="invite__home" href="/">
          PUBMAXXING
        </Link>
        <p className="invite__eyebrow">Invite</p>
        <h1 className="invite__emptyTitle">This invite isn&rsquo;t available right now</h1>
        <p className="invite__emptyBody">Try the link again shortly.</p>
      </div>
    </main>
  );
}

export default async function PlanInvitePage({ params }: PageProps) {
  const { token } = await params;

  const lookup = await resolvePlanIdByInviteToken(token);
  if (!lookup.ok) return <InviteUnavailable />;
  if (!lookup.planId) return <InviteNotFound />;

  const stateResult = await planStateResult(lookup.planId);
  if (!stateResult.ok) return <InviteUnavailable />;
  if (!stateResult.plan) return <InviteNotFound />;

  const state = stateResult.plan;
  const [stops, summaries] = await Promise.all([
    loadStops(state.stops),
    loadInitialSummaries(lookup.planId),
  ]);

  const hostHandle = state.crew[0]?.name || "Your host";
  const startLabel = formatStartLabel(state.plan.startTime);
  const alcoholOptionalLine = planAlcoholOptionalInviteLine({
    title: state.plan.title,
    context: state.context,
  });
  const routePoints = stops
    .map((stop) => stop.coordinates)
    .filter((point): point is [number, number] => point !== null);
  const spendBand = inviteSpendBand(stops);

  return (
    <main id="main" className="invite">
      <div className="invite__mat">
        <div className="invite__kicker">
          <Link className="invite__brand" href="/">
            PUBMAXXING
          </Link>
          <span className="invite__edition">You&rsquo;re invited</span>
        </div>

        {routePoints.length >= 2 ? (
          <div className="invite__thumbFrame">
            <RouteThumbnail
              className="invite__thumb"
              points={routePoints}
              label={`Route shape for ${state.plan.title}`}
            />
          </div>
        ) : null}

        <p className="invite__eyebrow">Hosted by {hostHandle}</p>
        <h1 className="invite__title">{state.plan.title}</h1>
        <p className="invite__start">{startLabel}</p>
        {spendBand ? <p className="invite__spend">{formatPlanInviteSpendBand(spendBand)}</p> : null}
        {alcoholOptionalLine ? (
          <p className="invite__softNote">{alcoholOptionalLine}</p>
        ) : null}

        <ol className="invite__stops">
          {stops.map((stop) => (
            <li className="invite__stop" key={`${stop.position}-${stop.venueId}`}>
              <span className="invite__stopPosition">{stop.position + 1}</span>
              <span className="invite__stopName">{stop.venueName}</span>
              {stop.price ? <span className="invite__stopPrice">{stop.price}</span> : null}
            </li>
          ))}
        </ol>

        <p className="invite__softNote">
          Joining the crew with a signed-in claimed handle connects you with
          the host in your lot.
        </p>

        <PlanInviteRsvp
          token={token}
          planId={lookup.planId}
          initialRsvp={summaries.rsvp}
          initialReactions={summaries.reactions}
          venueIds={stops.map((stop) => stop.venueId)}
        />
        <InvitePageView hasRsvps={summaries.rsvp.guests.length > 0} />
      </div>
    </main>
  );
}
