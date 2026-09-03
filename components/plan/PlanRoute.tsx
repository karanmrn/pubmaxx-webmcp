"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { CalendarClock, Music, Tag, Ticket, Tv, type LucideIcon } from "lucide-react";

// Type-only import of the wire contract — the API and this component share one
// source of truth (lib/planGetIn) so the shapes cannot drift. Erased at build,
// so no server code reaches the client bundle.
import type { PlanGetInReportDTO, PlanGetInStopDTO } from "@/lib/planGetIn";
import PlanRouteMiniMap from "@/components/plan/PlanRouteMiniMap";
import { buildCrawlMapHref } from "@/lib/crawlUrl";
import { discardBody } from "@/lib/responseBody";
import { isValidWhatsOnRow, type WhatsOnKind, type WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel } from "@/lib/whatsOnBadges";
import { stopEventChips, type StopEventChip } from "@/lib/planWhatsOn";

type RouteStop = { venueId: string; venueName: string; position: number };

type StopSignal = PlanGetInStopDTO;
type GetInReport = PlanGetInReportDTO;

type FetchState = "loading" | "ready" | "unavailable";

// Same glyph vocabulary as the venue-sheet W1 "on tonight" chips
// (components/map/VenueTonightChips.tsx) so a stop event reads as the same
// signal wherever it appears — redeclared locally rather than imported since
// that module is a held map-lane surface.
const KIND_ICON: Record<WhatsOnKind, LucideIcon> = {
  quiz: CalendarClock,
  sport: Tv,
  deal: Tag,
  music: Music,
  event: Ticket,
};

const CONFIDENCE_LABEL: Record<StopEventChip["confidence"], string> = {
  confirmed: "Confirmed",
  listed: "Listed",
  derived: "Inferred",
};

export default function PlanRoute({
  planId,
  startTime,
  stops,
}: {
  planId: string;
  startTime: string;
  stops: RouteStop[];
}) {
  const [report, setReport] = useState<GetInReport | null>(null);
  const [state, setState] = useState<FetchState>("loading");
  const [events, setEvents] = useState<Map<string, StopEventChip>>(new Map());

  useEffect(() => {
    let active = true;
    fetch(`/api/plans/${planId}/getin`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: GetInReport) => {
        if (!active) return;
        setReport(body && Array.isArray(body.stops) ? body : null);
        setState(body && Array.isArray(body.stops) ? "ready" : "unavailable");
      })
      .catch(() => {
        if (active) setState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [planId]);

  // On-tonight event chips (C3): honest, grounded from the primary What's-On
  // spine — the same venueId-exact join the venue sheet's W1 badges use. Fail
  // soft: any fetch failure or no-match simply renders no chips.
  const venueKey = stops.map((stop) => stop.venueId).join(",");
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/whats-on?window=tonight&limit=60", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { rows?: unknown };
        const rows = Array.isArray(body.rows)
          ? body.rows.filter((row): row is WhatsOnRow => isValidWhatsOnRow(row))
          : [];
        const chips = stopEventChips(rows, venueKey ? venueKey.split(",") : [], startTime);
        if (!controller.signal.aborted) setEvents(chips);
      } catch {
        /* fail-soft: no chips */
      }
    })();
    return () => controller.abort();
  }, [venueKey, startTime]);

  const signals = new Map((report?.stops ?? []).map((stop) => [stop.venueId, stop]));
  const groupSize = report?.groupSize ?? 0;
  // Deep link the whole ordered crawl onto the map, where the route now follows
  // real walking roads. The per-stop "Open on the map" links below still jump to
  // a single pin; this shows the walk between every stop.
  const walkRouteHref = buildCrawlMapHref(stops.map((stop) => stop.venueId));

  return (
    <div className="planRoute">
      {state === "ready" && groupSize > 0 ? (
        <p className="planRoute__basis">
          Get-in estimate for {groupSize === 1 ? "one" : groupSize} going. Never a guarantee of entry.
        </p>
      ) : null}
      {/* Static route mini-map (T8): the crawl drawn as numbered discs on the
          walking line, straight-then-routed with the same solid/dashed honesty
          rule as the big map. Degrades to nothing when it can't locate ≥2 stops,
          so the deep link below always stands on its own. */}
      {stops.length >= 2 ? <PlanRouteMiniMap stops={stops} /> : null}
      {walkRouteHref ? (
        <Link className="planRoute__walk" href={walkRouteHref}>
          See the walking route
        </Link>
      ) : null}
      <ol className="planSummary__stops">
        {stops.map((stop, index) => {
          const signal = signals.get(stop.venueId);
          return (
            <li key={`${stop.position}-${stop.venueId}`} style={{ "--i": index } as CSSProperties}>
              <span className="planSummary__marker">{index + 1}</span>
              <div className="planRoute__body">
                <strong>{stop.venueName}</strong>
                <StopEventBadge event={events.get(stop.venueId)} />
                <Link href={`/map?venue=${encodeURIComponent(stop.venueId)}`}>Open on the map</Link>
                <StopGetIn state={state} signal={signal} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StopEventBadge({ event }: { event: StopEventChip | undefined }) {
  if (!event) return null;
  const Icon = KIND_ICON[event.kind];
  const provenance = `${CONFIDENCE_LABEL[event.confidence]} · ${event.sourceLabel} · ${checkedLabel(event.observedAt).toLowerCase()}`;
  return (
    <span className="planRoute__event" data-kind={event.kind} title={provenance}>
      <Icon size={12} aria-hidden="true" />
      {event.label}
      <a
        className="planRoute__eventSource"
        href={event.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
      >
        source
      </a>
    </span>
  );
}

function StopGetIn({ state, signal }: { state: FetchState; signal: StopSignal | undefined }) {
  if (state === "loading") {
    return <span className="planRoute__signal planRoute__signal--loading" aria-hidden="true" />;
  }
  if (state === "unavailable" || !signal) return null;

  const { busyness, getIn, booking } = signal;
  const closed = busyness?.isOpen === false;

  return (
    <div className="planRoute__signal" data-fit={getIn.fit}>
      {busyness ? (
        <span className="planRoute__busy" title={busyness.explanation}>
          <span className="planRoute__dot" data-level={busyness.level} aria-hidden="true" />
          {closed ? "Likely closed now" : busyness.label}
        </span>
      ) : null}
      <span className="planRoute__fit" title={getIn.reason}>
        {getIn.label}
      </span>
      {booking.available && booking.href ? (
        <a
          className="planRoute__book"
          href={booking.href}
          target="_blank"
          rel="noreferrer noopener"
        >
          {booking.label}
        </a>
      ) : null}
    </div>
  );
}
