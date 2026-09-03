import { ImageResponse } from "next/og";

import { PLAN_STOP_MAX, type PlanStopDTO } from "@/lib/plan";
import { planStateResult, resolvePlanIdByInviteToken } from "@/lib/planStore";
import {
  formatPlanInviteSpendBand,
  planInviteSpendBandFromListedPrices,
  type PlanInviteSpendBand,
} from "@/lib/shareArtifacts";
import { formatPrice } from "@/lib/venues";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import {
  CardShell,
  OG,
  OG_CACHE_HEADERS,
  OG_SIZE,
  Wordmark,
  loadOgFonts,
} from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";

// Share card for a Plan's public invite link (Task: plan-invite-page). Same
// brand kit and generic-poster-on-failure shape as the borough card: an
// unresolvable token, a store outage, or a Crew-bound plan (out of this
// feature's scope, see app/invite/[token]/page.tsx) all degrade to a plain
// PUBMAXX poster rather than throwing or inventing a plan.
//
// runtime = "nodejs": loadOgFonts reads the Space Grotesk TTFs from
// public/fonts via node:fs, same as every sibling OG route.

export const runtime = "nodejs";
export const alt = "You're invited on PUBMAXX";
export const size = OG_SIZE;
export const contentType = "image/png";

type CardData = {
  title: string;
  hostHandle: string;
  startLabel: string;
  spendBand: PlanInviteSpendBand | null;
  stops: { name: string; price: string | null }[];
};

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

async function loadStops(
  stops: PlanStopDTO[],
): Promise<{ name: string; price: string | null; priceGbp: number | null }[]> {
  const ordered = [...stops].sort((a, b) => a.position - b.position).slice(0, PLAN_STOP_MAX);
  const details = await Promise.all(ordered.map((stop) => lookupVenueDetail(stop.venueId)));
  return ordered.map((stop, index) => {
    const detail = details[index];
    const venue = detail.status === "found" ? detail.venue : null;
    return {
      name: stop.venueName,
      price: venue && typeof venue.cheapestPrice === "number" ? formatPrice(venue.cheapestPrice) : null,
      priceGbp: venue && typeof venue.cheapestPrice === "number" ? venue.cheapestPrice : null,
    };
  });
}

// Never throws — any failure (bad token, outage, out-of-scope plan) yields
// null and the card falls back to the generic poster.
async function loadCard(token: string): Promise<CardData | null> {
  try {
    const lookup = await resolvePlanIdByInviteToken(token);
    if (!lookup.ok || !lookup.planId) return null;
    const stateResult = await planStateResult(lookup.planId);
    if (!stateResult.ok || !stateResult.plan) return null;
    const state = stateResult.plan;
    const stops = await loadStops(state.stops);
    return {
      title: clampOgText(state.plan.title, 60, "A night out", {
        collapseWhitespace: true,
        collapseBeforeFilter: true,
      }),
      hostHandle: clampOgText(state.crew[0]?.name, 30, "Your host", {
        collapseWhitespace: true,
        collapseBeforeFilter: true,
      }),
      startLabel: formatStartLabel(state.plan.startTime),
      spendBand: planInviteSpendBandFromListedPrices(stops.map((stop) => stop.priceGbp)),
      stops,
    };
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await loadCard(token);

  if (!card) {
    return new ImageResponse(
      (
        <CardShell>
          <Wordmark />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: OG.ink }}>
              You&rsquo;re invited
            </div>
            <div style={{ display: "flex", fontSize: 26, color: OG.muted, marginTop: 14 }}>
              A pub crawl planned on PUBMAXX.
            </div>
          </div>
          <div style={{ display: "flex", color: OG.muted, fontSize: 24 }}>pubmaxxing.com</div>
        </CardShell>
      ),
      { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
    );
  }

  return new ImageResponse(
    (
      <CardShell>
        {/* Header: wordmark lockup + edition kicker */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <Wordmark />
          <div
            style={{
              display: "flex",
              color: OG.coral,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            You&rsquo;re invited
          </div>
        </div>

        {/* Middle: title, host, start time, stop list */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: card.title.length > 34 ? 54 : 68,
              fontWeight: 700,
              letterSpacing: -1,
              lineHeight: 1.05,
              color: OG.ink,
            }}
          >
            {card.title}
          </div>
          <div style={{ display: "flex", color: OG.inkSoft, fontSize: 26, marginTop: 14 }}>
            Hosted by {card.hostHandle} · {card.startLabel}
            {card.spendBand ? ` · ${formatPlanInviteSpendBand(card.spendBand)}` : ""}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 28, gap: 10 }}>
            {card.stops.slice(0, 4).map((stop, index) => (
              <div
                key={`${index}-${stop.name}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ display: "flex", color: OG.ink, fontSize: 28, fontWeight: 500 }}>
                  {index + 1}. {clampOgText(stop.name, 36, "", {
                    collapseWhitespace: true,
                    collapseBeforeFilter: true,
                  })}
                </div>
                {stop.price ? (
                  <div style={{ display: "flex", color: OG.amber, fontSize: 28, fontWeight: 700 }}>
                    {stop.price}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", color: OG.muted, fontSize: 24, letterSpacing: 0.5 }}>
            Going · Maybe · a guest list that fills in live
          </div>
          <div style={{ display: "flex", alignItems: "center", color: OG.coral, fontSize: 26, fontWeight: 700 }}>
            <div style={{ width: 44, height: 2, background: OG.coral, marginRight: 16 }} />
            pubmaxxing.com
          </div>
        </div>
      </CardShell>
    ),
    { ...size, fonts: loadOgFonts(), headers: OG_CACHE_HEADERS },
  );
}
