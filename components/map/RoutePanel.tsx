"use client";

import { useMemo, useState } from "react";

import { crawlSummary, type Filters, type Venue } from "@/lib/venues";
import { LONDON_POIS_PATH } from "@/lib/pois";
import {
  buildRouteLegs,
  type RoutePace,
} from "@/lib/routeLegs";
import type { CrawlJourneyLegSummary } from "@/components/map/useCrawlJourneys";
import { styleLabels, type CrawlMode } from "@/components/map/ControlRail";
import SaveCrawlStory from "@/components/crawl/SaveCrawlStory";
import {
  altStyleStopNoun,
  type AltCrawlStyle,
} from "@/lib/crawlUrl";
import { buildCrawlIcs, icsFilename } from "@/lib/icsExport";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import {
  curatedCrawlByIdForCity,
  curatedCrawlsForCity,
} from "@/lib/cityCuratedCrawls";
import { cityAwareMapPath, crawlShareMapHref } from "@/lib/curatedCrawls";
import { downloadIcs } from "@/lib/routePanelIcs";
import RouteHeader from "@/components/map/route/RouteHeader";
import RouteMetrics from "@/components/map/route/RouteMetrics";
import RouteActions from "@/components/map/route/RouteActions";
import RouteList from "@/components/map/route/RouteList";
import CrawlProgressSection from "@/components/map/route/CrawlProgressSection";
import VenuePicker from "@/components/map/route/VenuePicker";
import { useRoutePois } from "@/components/map/route/useRoutePois";
import { useCrawlProgress } from "@/components/map/route/useCrawlProgress";
import "@/components/map/routePanel.css";

type VenueSignals = Map<
  string,
  { hasPintDrops: boolean; dropCount?: number; latestContributorPrice: number | null }
>;

type RoutePanelProps = {
  mode: CrawlMode;
  crawlStyle: Filters["crawlStyle"];
  // Alt crawl style (issue #31): the "kind of night" label. Shapes copy + the
  // .ics export noun; independent of the scoring crawlStyle above.
  altStyle: AltCrawlStyle;
  onAltStyleChange: (style: AltCrawlStyle) => void;
  route: Venue[];
  filteredVenues: Venue[];
  builtIds: string[];
  activeVenueId: string | undefined;
  venueSignals: VenueSignals;
  crawlBlurb?: string;
  crawlName?: string;
  crawlId?: string;
  routeMapped: boolean;
  originDistanceKm?: number | null;
  onMapRoute: () => void;
  onHideRoute: () => void;
  onCheckLastTrain?: () => void;
  onSelectVenue: (id: string) => void;
  onToggleStop: (id: string) => void;
  onReverseRoute?: () => void;
  children?: React.ReactNode;
  /** City display name for map-route chrome (defaults to London). */
  cityDisplayName?: string;
  /** Active map city — drives share / log deep-links off London. */
  cityId?: CityId;
  /** Optional POI path; null skips London POI fetch for non-London cities. */
  poisPath?: string | null;
  /** Fires when Plan-drawer RoundStarter mints a Round (stay-on-map). */
  onRoundStarted?: (code: string) => void;
  /** London-only CityMCP TfL legs keyed by destination stop index. */
  journeyByToIndex?: Map<number, CrawlJourneyLegSummary>;
  journeyLoading?: boolean;
  journeyTotalMinutes?: number | null;
};

export default function RoutePanel({
  mode,
  crawlStyle,
  altStyle,
  onAltStyleChange,
  route,
  filteredVenues,
  builtIds,
  activeVenueId,
  venueSignals,
  crawlBlurb,
  crawlName,
  crawlId,
  routeMapped,
  originDistanceKm,
  onMapRoute,
  onHideRoute,
  onCheckLastTrain,
  onSelectVenue,
  onToggleStop,
  onReverseRoute,
  children,
  cityDisplayName = "London",
  cityId = DEFAULT_CITY_ID,
  poisPath = LONDON_POIS_PATH,
  onRoundStarted,
  journeyByToIndex,
  journeyLoading = false,
  journeyTotalMinutes = null,
}: RoutePanelProps) {
  const summary = useMemo(() => crawlSummary(route), [route]);
  const routeWaterCount = route.filter((venue) => venue.curation.nearWater).length;
  const routeHeritageCount = route.filter((venue) => venue.hasStory).length;
  const routeWriterCount = route.filter((venue) => venue.curation.writerPick).length;

  // Walking (or running) legs between stops (story 25) — pure math from
  // lib/routeLegs, honestly labelled "straight-line" throughout.
  const [pace, setPace] = useState<RoutePace>("walk");
  const paceLabel = pace === "run" ? "Running" : "Walking";
  const legSummary = useMemo(() => buildRouteLegs(route, pace), [route, pace]);

  // "On the way" POI threading (story 26): garden/market/historic/viewpoint
  // POIs within ~250m of a leg. Loaded independently of the map canvas — a
  // second, cheap client fetch of the same bundled dataset — so RoutePanel
  // doesn't need PubMapCanvas's internal POI state lifted out.
  const onTheWayByLeg = useRoutePois(legSummary, poisPath);

  // Alt-style copy: a "coffee stop" / "food stop" / "mocktail stop" instead of
  // the default "pint stop". A single source (lib/crawlUrl) keeps label + noun
  // in sync with the URL round-trip.
  const stopNoun = altStyleStopNoun[altStyle];
  const crawlTitle =
    mode === "build" ? crawlName || "My hand-built crawl" : `${styleLabels[crawlStyle]} crawl`;

  // Loop 2 crawl-completion stickiness — localStorage only. Key off crawlId when
  // present, else a stable title slug so hand-built routes still track.
  const progressKey = (crawlId || crawlTitle).trim();
  const placeStoryBandId = crawlId
    ? curatedCrawlByIdForCity(cityId, crawlId)?.placeStoryBandId
    : undefined;
  const {
    crawlProgress,
    showCelebration,
    setShowCelebration,
    crawlDone,
    handleStartCrawl,
    handleMarkComplete,
  } = useCrawlProgress(progressKey, route, placeStoryBandId);

  const lastStopId = route.length > 0 ? route[route.length - 1]!.id : "";
  const dropHrefCity =
    cityIdFromVenueId(lastStopId) ?? cityId;
  const dropHref = lastStopId
    ? cityAwareMapPath(
        dropHrefCity,
        new URLSearchParams({ log: "1", sel: lastStopId }),
      )
    : cityAwareMapPath(cityId, new URLSearchParams({ log: "1" }));
  // Wave H1: share the walked route as a map deep-link (pubs + optional band).
  const shareMapHref = crawlShareMapHref({
    venueIds: route.map((v) => v.id),
    placeStoryBandId,
    crawlId,
    cityId,
    crawls: curatedCrawlsForCity(cityId),
  });

  function addToCalendar() {
    const crawl = {
      id: crawlId || crawlTitle,
      title: crawlTitle,
      blurb: crawlBlurb,
      stopNoun,
      stops: route.map((venue) => ({ name: venue.name, address: venue.address })),
    };
    downloadIcs(icsFilename(crawl), buildCrawlIcs(crawl));
  }

  return (
    <aside className="routePanel">
      <RouteHeader
        mode={mode}
        crawlStyle={crawlStyle}
        crawlName={crawlName}
        crawlBlurb={crawlBlurb}
        altStyle={altStyle}
        onAltStyleChange={onAltStyleChange}
      />

      <RouteMetrics
        summaryTotal={summary.total}
        summaryDistance={summary.distance}
        legSummary={legSummary}
        pace={pace}
        journeyTotalMinutes={journeyTotalMinutes}
        journeyLoading={journeyLoading}
        routeLength={route.length}
        stopNoun={stopNoun}
        routeHeritageCount={routeHeritageCount}
        routeWaterCount={routeWaterCount}
        routeWriterCount={routeWriterCount}
      />

      <RouteActions
        mode={mode}
        route={route}
        legSummary={legSummary}
        pace={pace}
        setPace={setPace}
        routeMapped={routeMapped}
        cityDisplayName={cityDisplayName}
        originDistanceKm={originDistanceKm}
        onMapRoute={onMapRoute}
        onHideRoute={onHideRoute}
        onReverseRoute={onReverseRoute}
        onCheckLastTrain={onCheckLastTrain}
        crawlTitle={crawlTitle}
        onRoundStarted={onRoundStarted}
        addToCalendar={addToCalendar}
      />

      {route.length >= 2 ? (
        <CrawlProgressSection
          crawlProgress={crawlProgress}
          crawlDone={crawlDone}
          showCelebration={showCelebration}
          setShowCelebration={setShowCelebration}
          handleStartCrawl={handleStartCrawl}
          handleMarkComplete={handleMarkComplete}
          paceLabel={paceLabel}
          placeStoryBandId={placeStoryBandId}
          dropHref={dropHref}
          shareMapHref={shareMapHref}
        />
      ) : null}

      {route.length >= 2 ? (
        <SaveCrawlStory
          stops={route.map((venue) => ({
            venueId: venue.id,
            name: venue.name,
            // The route's representative per-stop price (same signal the metrics
            // total uses) — the cheapest listed pint at that venue.
            priceGbp: venue.cheapestPrice,
          }))}
          defaultTitle={
            mode === "build"
              ? crawlName || "My hand-built crawl"
              : `${styleLabels[crawlStyle]} crawl`
          }
        />
      ) : null}

      <RouteList
        route={route}
        activeVenueId={activeVenueId}
        venueSignals={venueSignals}
        legSummary={legSummary}
        onTheWayByLeg={onTheWayByLeg}
        journeyByToIndex={journeyByToIndex}
        onSelectVenue={onSelectVenue}
      />

      {mode === "build" ? (
        <VenuePicker
          filteredVenues={filteredVenues}
          builtIds={builtIds}
          onSelectVenue={onSelectVenue}
          onToggleStop={onToggleStop}
        />
      ) : null}

      {children}
    </aside>
  );
}
