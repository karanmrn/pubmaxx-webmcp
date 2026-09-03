import Link from "next/link";
import { useEffect, useMemo } from "react";
import { MapPin } from "lucide-react";

import Disclosure from "@/components/Disclosure";
import PriceBadge from "@/components/PriceBadge";
import { Amenity, ClaimBadge } from "@/components/map/venueInspectorBits";
import {
  COMMUNITY_PRICE_NOTE,
  formatFreshness,
  formatObservedAt,
  formatPrice,
  type Venue,
} from "@/lib/venues";
import type { PricedVenue } from "@/lib/priceUpdates";
import {
  accessibilityChipLabels,
  quietHoursLabel,
} from "@/lib/venueAccessibility";
import { isPubVenue } from "@/lib/venueKindFilters";
import SaveToListControl from "@/components/savedpubs/SaveToListControl";
import SaveForNightButton from "@/components/wanted/SaveForNightButton";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import FirstDropNudge from "@/components/map/inspector/FirstDropNudge";
import VenueDrinkPrices from "@/components/map/VenueDrinkPrices";
import VenueSheetPriceEntry from "./VenueSheetPriceEntry";
import VenueCommunitySignals from "@/components/map/VenueCommunitySignals";
import VenuePriceThen from "@/components/map/VenuePriceThen";
import VenueAreaPriceCompare from "@/components/map/VenueAreaPriceCompare";
import VenueWeatherRecommendations from "@/components/map/VenueWeatherRecommendations";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import VenueActionStrip from "@/components/map/VenueActionStrip";
import CityPlaceStrip from "@/components/map/CityPlaceStrip";
import VenueBuzz from "@/components/map/VenueBuzz";
import VenueAwardBadge from "@/components/areanews/VenueAwardBadge";
import VenueHygiene from "@/components/map/VenueHygiene";
import VenueGettingThere, {
  type LocationRequestStatus,
} from "@/components/map/VenueGettingThere";
import VenueOccupancyRow from "@/components/map/VenueOccupancyRow";
import VisitReportPanel from "@/components/visits/VisitReportPanel";
import { cuisineTagsForVenue } from "@/lib/cuisineTags";
import type { CityId } from "@/lib/cities";
import type { JourneyPoint } from "@/lib/venueJourney";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { TabKey } from "@/lib/venueInspectorTabs";
import type { PresenceState } from "./usePresence";
import { anchorMonthLabel } from "@/lib/venueAnchorPresentation";
import {
  NO_ALCOHOL_LENS_PRICE_NOUN,
  type MapExperienceLens,
} from "@/lib/mapExperienceLens";
import { drinkLaneNoun, venueDrinkPriceView } from "@/lib/drinkLanes";
import { namedLegacyPintPriceSource, type DrinkCategory } from "@/lib/drinks";
import { overviewDisplayablePintGbp } from "@/lib/overviewDisplayablePint";
import type { ZonePintIndex } from "@/lib/zones";

function VenuePriceSummary({
  venue,
  latestContributorPrice,
  sourcedPrice,
  sourcedObserved,
  anchorStamp,
  onLogTonightPrice,
  onStartFirstDrop,
  priceRevealMotionClass = "",
}: {
  venue: Venue;
  latestContributorPrice: number | null | undefined;
  sourcedPrice: PricedVenue["sourcedPrice"];
  sourcedObserved: string;
  anchorStamp: string | null;
  onLogTonightPrice: () => void;
  onStartFirstDrop?: () => void;
  priceRevealMotionClass?: string;
}) {
  const chromeRevealClass = priceRevealMotionClass || undefined;
  const baselinePriceRow = venue.prices.find(
    (price) => price.price_gbp === venue.cheapestPrice,
  );
  const baselineSource = baselinePriceRow
    ? namedLegacyPintPriceSource(baselinePriceRow)
    : null;

  if (
    !isPubVenue(venue) &&
    venue.anchorLabel &&
    venue.cheapestPrice !== null &&
    venue.cheapestPrice !== undefined
  ) {
    return (
      <div className="contributorPrice">
        <span className={chromeRevealClass}>
          <ClaimBadge kind="sourced" /> {venue.anchorLabel}
        </span>
        <PriceBadge variant="current">
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        {anchorStamp || venue.anchorSourceUrl ? (
          <small className={chromeRevealClass}>
            {anchorStamp}
            {venue.anchorSourceUrl ? (
              <>
                {anchorStamp ? " · " : ""}
                <a
                  href={venue.anchorSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  source
                </a>
              </>
            ) : null}
          </small>
        ) : null}
        <small className={`communityPriceNote ${priceRevealMotionClass}`.trim()}>
          Not a pint price.
        </small>
      </div>
    );
  }

  if (latestContributorPrice !== null && latestContributorPrice !== undefined) {
    return (
      <div className="contributorPrice">
        <span className={chromeRevealClass}>
          <ClaimBadge kind="contributor" /> Latest Pint Drop price
        </span>
        <PriceBadge variant="current">
          {formatPrice(latestContributorPrice)}
        </PriceBadge>
        {venue.latestContributorAt ? (
          <small className={chromeRevealClass}>{formatFreshness(venue.latestContributorAt)}</small>
        ) : null}
        <small className={`communityPriceNote ${priceRevealMotionClass}`.trim()}>
          {COMMUNITY_PRICE_NOTE}
        </small>
      </div>
    );
  }

  if (sourcedPrice) {
    return (
      <div className="contributorPrice">
        <span className={chromeRevealClass}>
          <ClaimBadge kind="sourced" /> Sourced price
        </span>
        <PriceBadge variant="current">
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        <small className={chromeRevealClass}>
          {sourcedObserved ? `${sourcedObserved} · ` : ""}
          <a
            className="priceSourceLink"
            href={sourcedPrice.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {sourcedPrice.sourceLabel}
          </a>
        </small>
      </div>
    );
  }

  if (venue.cheapestPrice !== null && venue.cheapestPrice !== undefined) {
    return (
      <div className="contributorPrice">
        <span className={chromeRevealClass}>
          <ClaimBadge kind="baseline" /> Baseline on record
        </span>
        <PriceBadge variant="baseline">
          {formatPrice(venue.cheapestPrice)}
        </PriceBadge>
        <small className={`communityPriceNote ${priceRevealMotionClass}`.trim()}>
          {baselineSource ? (
            <>
              Dataset price from{" "}
              <a
                href={baselineSource.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {baselineSource.label}
              </a>
              . Not a live tonight feed.
            </>
          ) : (
            <>
              Price on record. Publisher not recorded for this price. Not a live
              tonight feed.
            </>
          )}
        </small>
      </div>
    );
  }

  return isPubVenue(venue) ? (
    <FirstDropNudge
      venueId={venue.id}
      venueName={venue.name}
      onLogTonightPrice={onLogTonightPrice}
      onStartFirstDrop={onStartFirstDrop}
    />
  ) : null;
}

export default function VenueOverviewTab({
  venue,
  tab,
  cityId,
  mode,
  inCrawl,
  latestContributorPrice,
  latestPintDropAt,
  communityPrices,
  experienceLens,
  drinkLensCategory = null,
  onToggleStop,
  presenceState,
  markPresenceHere,
  userLocation,
  locationRequestStatus,
  onRequestLocation,
  onClearLocation,
  onLogTonightPrice,
  onStartFirstDrop,
  onOpenVisitReports,
  priceEntryAllowed,
  priceSignInRequested,
  priceAuthLoading,
  priceFocusRequest,
  zoneIndex,
  onLogged,
  priceRevealMotionClass = "",
  revealRecord = false,
  revealRecordLate = false,
  now,
}: {
  venue: Venue;
  tab: TabKey;
  cityId: CityId;
  mode: CrawlMode;
  inCrawl: boolean;
  latestContributorPrice: number | null | undefined;
  /** Epoch ms of the latest Pint Drop (unmerged drop signal) - lets the
   *  submit receipt refuse to claim the map when a newer drop outranks the
   *  community figure in mergeCommunityPriceSignals. */
  latestPintDropAt?: number | null;
  /** Community price layer - the dated submission row plus the submit card. */
  communityPrices: CommunityPricesState;
  experienceLens: MapExperienceLens;
  /** Selected-drink map lens (e.g. coffee). Never the no-alcohol experience. */
  drinkLensCategory?: DrinkCategory | null;
  onToggleStop: (id: string) => void;
  presenceState: PresenceState;
  markPresenceHere: () => void;
  userLocation: JourneyPoint | null;
  locationRequestStatus: LocationRequestStatus;
  onRequestLocation: () => void;
  onClearLocation: () => void;
  /** Community price path — primary unpriced CTA (map trust). */
  onLogTonightPrice: () => void;
  /** Opens the existing Pint Drop composer prefilled for this venue (Pints
   *  tab + composer open). Fired by the first-drop nudge on unpriced venues. */
  onStartFirstDrop: () => void;
  /** Opens Lore, where the full Visit Report composer and list live. */
  onOpenVisitReports: () => void;
  priceEntryAllowed: boolean;
  priceSignInRequested: boolean;
  priceAuthLoading: boolean;
  priceFocusRequest: number;
  /** Per-zone median pint index from the map's priced pubs — zone fallback
   *  when the Pint Index league has no borough row for this pub. */
  zoneIndex?: ZonePintIndex | null;
  /** Refresh this venue's Pint Drops after a successful Log it. */
  onLogged?: (venueId: string) => void;
  priceRevealMotionClass?: string;
  revealRecord?: boolean;
  revealRecordLate?: boolean;
  now?: number;
}) {
  // Known-true accessibility facts only (PRD issue #28). Unknown/known-false
  // facets render nothing — never a "No" — per the provenance-honesty rule.
  const accessChips = accessibilityChipLabels(venue);
  const quietHours = quietHoursLabel(venue);

  // Soft cuisine chips (Wave E) — curated id map ∪ searchText keywords.
  const cuisineTags = useMemo(
    () =>
      cuisineTagsForVenue({
        id: venue.id,
        name: venue.name,
        searchText: venue.filterHints?.searchText,
        hintTags: venue.filterHints?.cuisineTags,
      }),
    [venue.id, venue.name, venue.filterHints?.searchText, venue.filterHints?.cuisineTags],
  );

  // This tab makes a claim about what is logged here, so it asks for the read
  // itself rather than inheriting it from the pub-only submit card below: a
  // bar or a restaurant belongs in the no-alcohol view and would otherwise sit
  // for ever on a read that never started.
  const loadVenue = communityPrices.loadVenue;
  useEffect(() => {
    loadVenue(venue.id);
  }, [loadVenue, venue.id]);

  // The ordinary view names the freshest category; the no-alcohol view admits
  // only its two categories, while the food view reserves this slot for the
  // sourced menu anchor below. Sheet visibility remains independent of map
  // authority, which still requires category-specific trust gates.
  const venueReadStatus =
    communityPrices.venuePriceStatus.get(venue.id) ?? "idle";
  const communityRows = communityPrices.byVenueId.get(venue.id);
  // What the prices-by-drink section may show, and which drink it reads first.
  // The food view reserves the slot for the sourced menu anchor below, and the
  // no-alcohol view admits only its own two categories; every other view shows
  // the pub's whole drink list with the map's lane at the top.
  const { rows: drinkPriceRows, lane: leadLane } = venueDrinkPriceView(
    communityRows,
    experienceLens,
    drinkLensCategory,
  );
  // Which lane leads, and what it is called in a sentence. The no-alcohol view
  // joins two categories, so it keeps its own shared noun rather than naming
  // one of them and hiding the other.
  const leadLaneNoun =
    experienceLens === "no-alcohol"
      ? NO_ALCOHOL_LENS_PRICE_NOUN
      : drinkLaneNoun(leadLane);

  const overviewPintGbp = overviewDisplayablePintGbp({
    cheapestPrice: venue.cheapestPrice,
    latestContributorPrice,
    latestPintDropAt,
    communityRows: communityRows,
  });

  // Sourced attribution from mergePriceUpdates (optional field on the runtime
  // venue object). Absent when community is fresher or no refresh exists.
  const sourcedPrice = (venue as PricedVenue).sourcedPrice ?? null;
  const sourcedObserved =
    sourcedPrice?.observedAt != null ? formatObservedAt(sourcedPrice.observedAt) : "";

  const anchorStamp = anchorMonthLabel(venue.anchorObservedAt);

  return (
    <div
      role="tabpanel"
      id="venuePanel-overview"
      aria-labelledby="venueTab-overview"
      className="venueTabPanel"
      hidden={tab !== "overview"}
    >
      <p className="venueAddress">{venue.address}</p>
      <VenueActionStrip venue={venue} />
      <VenueOccupancyRow
        venueId={venue.id}
        active={tab === "overview"}
        revealRecord={revealRecord}
        revealRecordLate={revealRecordLate}
      />
      {/* Visit Report peek: newest accounts only. The full composer stays on
          Lore (VenueStoryTab), so Overview never grows a second rating system. */}
      <VisitReportPanel
        venueId={venue.id}
        venueName={venue.name}
        mode="peek"
        active={tab === "overview"}
        onOpenFull={onOpenVisitReports}
      />
      {/* FSA food hygiene rating (FHRS), matched by postcode + fuzzy name
          server-side. Renders nothing for an unmatched pub. Kept above the
          practical-info disclosure so a matched rating is not buried. */}
      <VenueHygiene
        venueId={venue.id}
        venueName={venue.name}
        address={venue.address}
      />
      <Disclosure
        className="venueOverviewMore"
        bodyClassName="venueOverviewMoreBody"
        summary="Details and practical info"
      >
      <VenueGettingThere
        userLocation={userLocation}
        venueLocation={{ lat: venue.latitude, lng: venue.longitude }}
        londonTransit={cityId === "london"}
        locationRequestStatus={locationRequestStatus}
        onRequestLocation={onRequestLocation}
        onClearLocation={onClearLocation}
      />
      <CityPlaceStrip
        venueId={venue.id}
        venueName={venue.name}
        latitude={venue.latitude}
        longitude={venue.longitude}
        primaryBorough={venue.primaryBorough}
        cityId={cityId}
      />
      {/* "What people say" (task A3) — AI-synthesised third-party buzz via
          CityMCP, honestly labelled. Never community/editorial content. */}
      <VenueBuzz
        venueId={venue.id}
        venueName={venue.name}
        latitude={venue.latitude}
        longitude={venue.longitude}
        primaryBorough={venue.primaryBorough}
        cityId={cityId}
      />
      {/* Fresh-facts layer (Cycle 15 Lane A): an engraved brass plaque when a
          venue-matched award fact exists for this pin. Renders nothing otherwise. */}
      <VenueAwardBadge venueId={venue.id} />
      <div className="amenityRow">
        {/* Labels are reader-facing words, not data keys: "0.0" alone read as
            a leaked number and lowercase one-worders read as raw tags (owner
            audit). Sentence case, self-explanatory, still chip-short. */}
        <Amenity active={Boolean(venue.curation.nearWater)} label="Near water" />
        <Amenity active={venue.hasStory} label="Heritage" />
        <Amenity active={Boolean(venue.curation.writerPick)} label="Writer's pick" />
        <Amenity active={venue.amenities.beerGarden} label="Beer garden" />
        <Amenity active={venue.amenities.nonAlcoholic} label="Alcohol-free beer" />
        <Amenity active={venue.amenities.liveSports} label="Live sports" />
        <Amenity active={venue.amenities.food} label="Serves food" />
        <Amenity active={venue.amenities.cocktails} label="Cocktails" />
        <Amenity active={venue.amenities.pubQuiz} label="Pub quiz" />
      </div>
      {venue.amenities.food || cuisineTags.length > 0 ? (
        <div className="cuisineRow" aria-label="Food and cuisine">
          {venue.amenities.food ? (
            <p className="cuisineServes">
              <strong>Serves food</strong>
              {cuisineTags.length === 0
                ? ". Plates available; check the board for tonight’s kitchen."
                : null}
            </p>
          ) : null}
          {cuisineTags.length > 0 ? (
            <div className="cuisineTags">
              {cuisineTags.map((tag) => (
                <span key={tag} className="cuisineChip">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Accessibility — only publicly-confirmed facts, shown as chips. A pub
          with no confirmed access facts shows nothing here (never a "No"). */}
      {accessChips.length > 0 ? (
        <div className="accessibilityChips" aria-label="Confirmed accessibility">
          {accessChips.map((label) => (
            <span key={label} className="accessibilityChip">
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {quietHours ? (
        <p className="accessibilityQuietHours">
          <strong>Quiet hours:</strong> {quietHours}
        </p>
      ) : null}
          <VenueWeatherRecommendations
            key={`weather-recommendations-${venue.id}`}
            venueId={venue.id}
            venueName={venue.name}
          />
          {/* Quest chips show supporting profile progress, not a primary
              decision about this venue. Keep them with the optional detail. */}
          <NextBadgeChips />
      </Disclosure>
      {/* Read-first community observations: character, access and eating sit
          here so drinkers see them without opening price submit. Authoring
          stays on the price-entry path below (VenuePriceEntryPanel). The same
          venue-price read status feeds both, so a failed lookup never words
          as an empty pub. */}
      <VenueCommunitySignals
        venueId={venue.id}
        venueName={venue.name}
        signals={communityPrices.signalsByVenueId.get(venue.id) ?? []}
        readStatus={venueReadStatus}
        now={now}
        readOnly
      />
      {/* Tonight's community prices sit ATOP the price on record, never
          instead of it: their own rows, their own dated badges, and the
          sourced / baseline row below still renders untouched. A submission is
          an extra dated observation - it never overwrites a scraped or sourced
          figure. One row per drink, the map's lane first, so a cocktail map
          never opens a pub on somebody's coffee.
          Reporting stays public on every row because a reader must be able to
          challenge a displayed observation without becoming a contributor. The
          flag is recorded for a human - it does not hide the row. */}
      {experienceLens === "food" ? null : (
        <VenueDrinkPrices
          venueId={venue.id}
          venueName={venue.name}
          rows={drinkPriceRows}
          activeLane={leadLane}
          laneNoun={leadLaneNoun}
          readStatus={venueReadStatus}
          communityPrices={communityPrices}
          onLogPrice={onLogTonightPrice}
          canLog={isPubVenue(venue)}
          priceRevealMotionClass={priceRevealMotionClass}
          revealRecord={revealRecord}
          revealRecordLate={revealRecordLate}
        />
      )}
      {/* Price honesty on overview: community override wins, then sourced
          observation, then baseline-on-record. Never imply a live feed.
          Non-pub venues carry a type-specific anchor (a cocktail, a doner) —
          it renders under its own label with date and source, never as a
          pint figure. A selected-drink lens already answered above, so a beer
          baseline must not stand in for coffee (or wine, or soft drink). */}
      {!drinkLensCategory &&
      (experienceLens !== "no-alcohol" ||
        venue.kind === "food" ||
        venue.kind === "restaurant") ? (
        <VenuePriceSummary
          venue={venue}
          latestContributorPrice={latestContributorPrice}
          sourcedPrice={sourcedPrice}
          sourcedObserved={sourcedObserved}
          anchorStamp={anchorStamp}
          onLogTonightPrice={onLogTonightPrice}
          onStartFirstDrop={onStartFirstDrop}
          priceRevealMotionClass={
            drinkPriceRows?.length ? "" : priceRevealMotionClass
          }
        />
      ) : null}
      {/* What a pint here used to cost: one dated figure from the archives,
          against the price on record now. Sits directly under today's price
          because the comparison IS the point. History only - the old figure
          never enters bands, pins, cheapest buckets or the Pint Index
          (lib/priceHistory.ts). Renders nothing for a pub with no history.
          Hidden under a drink lens: an old pint does not answer coffee. */}
      {experienceLens === "all" && !drinkLensCategory ? (
        <VenuePriceThen
          venueId={venue.id}
        // "Now" is only offered where today's figure is a pint. A bar or food
        // venue's cheapestPrice is an anchor price (a cocktail, a dish), so it
        // is withheld rather than compared against an old pint.
          currentPriceGbp={isPubVenue(venue) ? overviewPintGbp : null}
        />
      ) : null}
      {/* Patch yardstick: this pint against the borough Pint Index average, or
          the fare-zone median when the Index has no row. Same displayable pint
          stack as the then-and-now block. Renders nothing without a yardstick. */}
      {experienceLens === "all" && isPubVenue(venue) ? (
        <VenueAreaPriceCompare
          priceGbp={overviewPintGbp}
          primaryBorough={venue.primaryBorough}
          zone={venue.zone}
          zoneIndex={zoneIndex}
        />
      ) : null}
      {/* The submission loop itself: pick a drink, type tonight's price, and
          the pin, the list row and the row above restamp on the same tap.
          Pubs only — a Pint Drop at a bar or late-food venue would
          feed a non-pint figure into the pint record. */}
      {isPubVenue(venue) ? (
        <VenueSheetPriceEntry
          // Keyed by venue so the chosen drink, the typed price and the receipt
          // never leak across pubs - this instance persists between selections.
          key={venue.id}
          venueId={venue.id}
          venueName={venue.name}
          isPub
          communityPrices={communityPrices}
          canSubmitPrice={priceEntryAllowed}
          showSignInGate={priceSignInRequested}
          authLoading={priceAuthLoading}
          baselinePriceGbp={latestContributorPrice ?? venue.cheapestPrice}
          latestPintDropAt={latestPintDropAt}
          focusRequest={priceFocusRequest}
          includeSignals={false}
          // The composer opens on the drink the map is under, so a cocktail map
          // does not ask a drinker to find cocktails again.
          laneCategory={leadLane}
          onLogged={onLogged}
        />
      ) : null}
      {mode === "build" && isPubVenue(venue) ? (
        <button
          className="addStopBtn"
          aria-pressed={inCrawl}
          onClick={() => onToggleStop(venue.id)}
        >
          {inCrawl ? "Remove from crawl" : "Add to crawl"}
        </button>
      ) : null}
      <SaveToListControl
        venueId={venue.id}
        venueName={venue.name}
        venueKind={venue.kind}
      />
      <SaveForNightButton venueId={venue.id} venueName={venue.name} />
      <div className="presenceHere">
        {presenceState === "here" ? (
          <p
            className="presenceHereConfirm"
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              margin: "12px 0 0",
              minHeight: "42px",
              fontWeight: 700,
              color: "var(--brass)",
            }}
          >
            <MapPin size={15} aria-hidden="true" /> You&rsquo;re here 🍺
          </p>
        ) : (
          <button
            type="button"
            className="addStopBtn"
            onClick={markPresenceHere}
            disabled={presenceState === "sending"}
            aria-label={`Mark that you're at ${venue.name} tonight`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <MapPin size={15} aria-hidden="true" />
            {presenceState === "sending" ? "Checking in…" : "I'm here"}
          </button>
        )}
        {presenceState === "no-handle" ? (
          <p
            className="description muted"
            style={{ marginTop: "8px", fontSize: "0.82rem" }}
          >
            Claim a handle to check in. <Link href="/u/you">Set yours</Link>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
