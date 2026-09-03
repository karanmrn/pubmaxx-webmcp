"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { ContributionGateDialog } from "@/components/identity/ContributionGateDialog";
import { type Venue } from "@/lib/venues";
import type { PintDropsState } from "@/components/map/usePintDrops";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { LastPintDecision } from "@/lib/tfl";
import { landmarks as londonLandmarks, type Landmark } from "@/lib/landmarks";
import { STORY_BANDS, type StoryBand } from "@/lib/storyBands";
import { type CuratedCrawl } from "@/lib/curatedCrawls";
import { type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { DEFAULT_TAB, tabsForVenue, type TabKey } from "@/lib/venueInspectorTabs";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { JourneyPoint } from "@/lib/venueJourney";
import type { LocationRequestStatus } from "@/components/map/VenueGettingThere";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import type { DrinkCategory } from "@/lib/drinks";
import type { ZonePintIndex } from "@/lib/zones";
import {
  venueRevealRootClasses,
  type VenueRevealRequest,
} from "@/lib/venueReveal";
import { useVenueReveal } from "@/components/map/useVenueReveal";
import { prefetchLastRide } from "@/lib/lastRideClient";
import {
  runPriceContributionRequest,
  runPriceContributionReturn,
} from "@/lib/priceContributionIntent";

import { useInspectorTabs } from "./inspector/useInspectorTabs";
import { usePresence } from "./inspector/usePresence";
import { useVenueShare } from "./inspector/useVenueShare";
import VenueInspectorHeader from "./inspector/VenueInspectorHeader";
import VenueOverviewTab from "./inspector/VenueOverviewTab";
import VenuePhotosTab from "./inspector/VenuePhotosTab";
import VenuePintsTab from "./inspector/VenuePintsTab";
import VenueMenuTab from "./inspector/VenueMenuTab";
import VenueStoryTab from "./inspector/VenueStoryTab";
import VenueAskTab from "./inspector/VenueAskTab";
import VenueGettingHomeTab from "./inspector/VenueGettingHomeTab";
import VenueStickyBar from "./inspector/VenueStickyBar";

import "./venueSheet.css";
import "./accessibilityFilters.css";

// TabKey is imported by other modules from this file — keep it re-exported here.
export type { TabKey };

type VenueInspectorProps = {
  venue: Venue;
  mode: CrawlMode;
  inCrawl: boolean;
  latestContributorPrice: number | null | undefined;
  /** Epoch ms of the latest Pint Drop, from the unmerged drop signal - see
   *  VenueOverviewTab, which hands it to the submit receipt. */
  latestPintDropAt?: number | null;
  /**
   * Map-authority people-logged pint for share copy: the merged signal the
   * pins already paint (corroborated community candidate and/or contributor
   * drop). Never a sheet-only uncorroborated report.
   */
  shareLoggedPintGbp?: number | null;
  /** Epoch ms for shareLoggedPintGbp. */
  shareLoggedAt?: number | null;
  onToggleStop: (id: string) => void;
  onSelectVenue?: (id: string) => void;
  /** Trusted-handoff §4.8 "Make it Stop 1": accept this Venue into a Plan. */
  onAcceptStop1?: () => void;
  acceptanceError?: string | null;
  initialTab?: TabKey;
  pintDrops: PintDropsState;
  /**
   * Community price layer - backs the fast "What's it tonight?" submission on
   * the Overview tab and the restamp every other surface reads.
   */
  communityPrices: CommunityPricesState;
  // The mobile bottom-sheet drag gesture (GH #17) lives in PubMap.tsx (the
  // owner of the .mapDrawer seam); this component only exposes the grab
  // handle as a pointer-event surface so the drag can start from the visible
  // grabber, not just the header bar above it. All three are no-ops on
  // desktop (PubMap gates the gesture to ≤640px before anything fires).
  onGrabDragStart?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragMove?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragEnd?: (event: React.PointerEvent<HTMLElement>) => void;
  onTabSelect?: (key: TabKey) => void;
  /** City landmark catalog for Lore "Around here". Defaults to London. */
  cityLandmarks?: Landmark[];
  /** City Place-story corridors. Defaults to London. */
  cityStoryBands?: StoryBand[];
  /** City curated crawls for Place-story deep links. Defaults to London. */
  cityCuratedCrawls?: CuratedCrawl[];
  /** Active map city — drives Last Pint / Last Tram provider. Defaults to London. */
  cityId?: CityId;
  userLocation: JourneyPoint | null;
  locationRequestStatus: LocationRequestStatus;
  onRequestLocation: () => void;
  onClearLocation: () => void;
  experienceLens?: MapExperienceLens;
  /** Selected-drink map lens (e.g. coffee). Never the no-alcohol experience. */
  drinkLensCategory?: DrinkCategory | null;
  /** Per-zone median pint index for the Overview area-price compare line. */
  zoneIndex?: ZonePintIndex | null;
  /** Refresh this venue's Pint Drops after a successful Log it. */
  onLogged?: (venueId: string) => void;
  revealRequest?: VenueRevealRequest | null;
  onInterruptReveal?: () => void;
};

function focusPriceDestination(id: string): void {
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      const destination = document.getElementById(id);
      destination?.focus({ preventScroll: true });
      destination?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, 120);
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function VenueInspector({
  venue,
  mode,
  inCrawl,
  latestContributorPrice,
  latestPintDropAt,
  shareLoggedPintGbp = null,
  shareLoggedAt = null,
  onToggleStop,
  onSelectVenue,
  onAcceptStop1,
  acceptanceError = null,
  initialTab = DEFAULT_TAB,
  pintDrops,
  communityPrices,
  onGrabDragStart,
  onGrabDragMove,
  onGrabDragEnd,
  onTabSelect,
  cityLandmarks = londonLandmarks,
  cityStoryBands = STORY_BANDS,
  cityCuratedCrawls,
  cityId = DEFAULT_CITY_ID,
  userLocation,
  locationRequestStatus,
  onRequestLocation,
  onClearLocation,
  experienceLens = "all",
  drinkLensCategory = null,
  zoneIndex = null,
  onLogged,
  revealRequest = null,
  onInterruptReveal,
}: VenueInspectorProps) {
  const revealInterrupted =
    revealRequest?.venueId === venue.id && revealRequest.interrupted;
  const {
    reveal,
    beginReveal,
    updateRevealPriceMotion,
    interruptReveal,
    revealRootRef,
    revealStyle,
  } = useVenueReveal(revealInterrupted);

  useEffect(() => {
    if (!revealRequest || revealRequest.venueId !== venue.id) return;
    if (revealRequest.interrupted) {
      interruptReveal();
      return;
    }
    if (reveal?.sequence === revealRequest.sequence) return;
    beginReveal(
      revealRequest.venueId,
      revealRequest.rows,
      revealRequest.lane,
      {
        startedAt: revealRequest.startedAt,
        form: revealRequest.form,
        sequence: revealRequest.sequence,
      },
    );
  }, [beginReveal, interruptReveal, reveal, revealRequest, venue.id]);

  useEffect(() => {
    if (!revealRequest || revealRequest.venueId !== venue.id) return;
    updateRevealPriceMotion(
      revealRequest.venueId,
      revealRequest.rows,
      revealRequest.lane,
    );
  }, [revealRequest, updateRevealPriceMotion, venue.id]);

  const revealIsCurrent = Boolean(
      reveal &&
      revealRequest &&
      revealRequest.venueId === venue.id &&
      revealRequest.sequence === reveal.sequence &&
      !revealRequest.interrupted,
  );
  const currentReveal = revealIsCurrent ? reveal : null;
  const revealVenueId =
    currentReveal?.active
      ? venue.id
      : null;
  const revealRecord =
    currentReveal?.form === "full";
  const revealRecordLate = revealRecord && !currentReveal?.active;
  const priceRevealMotionClass =
    currentReveal?.priceMotionClass ?? "";
  // Keep a completed record class on a late-mounted inspector. Its negative
  // animation delay places content at final values, while interruption still
  // removes the class through revealIsCurrent.
  const currentRevealRootClasses =
    revealIsCurrent && currentReveal
      ? venueRevealRootClasses({
          active: true,
          form: currentReveal.form,
          interrupted: false,
        })
      : "";
  const { dropsByVenueId, setComposerOpen } = pintDrops;
  const { user, handle, loading: authLoading, configured: authConfigured } = useAuth();
  const [priceSignInVenueId, setPriceSignInVenueId] = useState<string | null>(
    null,
  );
  const [priceOnboardingOpen, setPriceOnboardingOpen] = useState(false);
  const [priceFocusRequest, setPriceFocusRequest] = useState<{
    venueId: string | null;
    count: number;
  }>({ venueId: null, count: 0 });
  const drops = useMemo(() => dropsByVenueId.get(venue.id) ?? [], [dropsByVenueId, venue.id]);
  const pubVenue = isPubVenue(venue);
  const TABS = useMemo(() => tabsForVenue(cityId, venue.kind), [cityId, venue.kind]);
  const safeInitialTab = pubVenue || initialTab !== "pints" ? initialTab : DEFAULT_TAB;

  // E3′ — the header photo prefers a chain (scraped) photo but falls back to
  // the most recent community Pint Drop photo for this venue so a pub with no
  // scraped image still gets an honestly-labelled community shot instead of
  // the empty gradient.
  const communityPhotoUrl = useMemo(
    () =>
      drops.find((drop) => drop.venuePhotoUrl)?.venuePhotoUrl ??
      drops.find((drop) => drop.pintPhotoUrl)?.pintPhotoUrl ??
      null,
    [drops],
  );

  const { presenceState, markPresenceHere } = usePresence(venue);
  const { tab, selectTab, onTabKeyDown, tabRefs } = useInspectorTabs(
    safeInitialTab,
    venue.id,
    TABS,
    onTabSelect,
  );
  const { currentShareFeedback, shareVenue } = useVenueShare(venue, {
    priceGbp: shareLoggedPintGbp,
    atMs: shareLoggedAt,
  });

  function startPintDrop() {
    if (!pubVenue) return;
    selectTab("pints");
    setComposerOpen(true);
  }

  const openPriceForm = useCallback((): void => {
    selectTab("overview");
    setPriceSignInVenueId(null);
    setPriceFocusRequest((current) => ({
      venueId: venue.id,
      count: current.venueId === venue.id ? current.count + 1 : 1,
    }));
  }, [selectTab, venue.id]);

  function requestPriceEntry(): void {
    // Signed-in but unfinished profile: send to claim before the form, so the
    // drinker never types a price and only then learns they need a handle.
    if (authConfigured && user && !handle) {
      selectTab("overview");
      setPriceSignInVenueId(null);
      setPriceOnboardingOpen(true);
      return;
    }
    runPriceContributionRequest({
      authConfigured,
      userPresent: Boolean(user),
      venueId: venue.id,
      currentUrl: window.location.href,
      storage: browserStorage(),
      actions: {
        replaceUrl: (url) => {
          window.history.replaceState(window.history.state, "", url);
        },
        showSignIn: () => {
          selectTab("overview");
          setPriceSignInVenueId(venue.id);
          focusPriceDestination("venuePriceSignInTitle");
        },
        openForm: openPriceForm,
      },
    });
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      runPriceContributionReturn({
        authConfigured,
        authLoading,
        userPresent: Boolean(user),
        venueId: venue.id,
        requestedVenueId: priceSignInVenueId,
        currentUrl: window.location.href,
        storage: browserStorage(),
        actions: {
          replaceUrl: (url) => {
            window.history.replaceState(window.history.state, "", url);
          },
          showSignIn: () => {
            selectTab("overview");
            setPriceSignInVenueId(venue.id);
            focusPriceDestination("venuePriceSignInTitle");
          },
          openForm: openPriceForm,
          abandon: () => setPriceSignInVenueId(null),
        },
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    authConfigured,
    authLoading,
    openPriceForm,
    priceSignInVenueId,
    selectTab,
    user,
    venue.id,
  ]);

  // Start transport work with the sheet, not several taps later when the Train
  // tab mounts. LastTrainCard shares this bounded request and still owns all
  // visible loading, success, and fallback states.
  useEffect(() => {
    prefetchLastRide(cityId, venue.latitude, venue.longitude);
  }, [cityId, venue.latitude, venue.longitude]);

  // The venue's live Last Pint decision, lifted up from LastTrainCard so the
  // Pints tab can stamp each drop with an honest transport-context badge (IDEAS
  // A5). HONESTY CONSTRAINT: this stays null until the user opens the
  // Getting-home tab and LastTrainCard publishes the prefetched answer. So if
  // they never open that tab, no badges render.
  // That's correct: a badge without a live decision behind it would be a guess.
  // LastTrainCard still owns the visible result; it only publishes that result
  // via the onDecision callback below. Reset on venue change (same adjust-state-during-
  // render pattern as tab/presence — never an effect) so a stale decision from
  // the previous pub can't leak onto this one's drops.
  const [lastTrainDecision, setLastTrainDecision] = useState<LastPintDecision | null>(null);
  const [decisionVenueId, setDecisionVenueId] = useState(venue.id);
  if (decisionVenueId !== venue.id) {
    setDecisionVenueId(venue.id);
    setLastTrainDecision(null);
  }

  return (
    <section
      ref={revealRootRef}
      className={`venueInspector ${currentRevealRootClasses}${revealRecord ? " venueRevealRecords" : ""}`.trim()}
      data-reveal={revealVenueId ?? undefined}
      style={revealStyle}
    >
      <VenueInspectorHeader
      venue={venue}
        communityPhotoUrl={communityPhotoUrl}
        TABS={TABS}
        tab={tab}
        selectTab={selectTab}
        onTabKeyDown={onTabKeyDown}
        tabRefs={tabRefs}
        onGrabDragStart={onGrabDragStart}
        onGrabDragMove={onGrabDragMove}
        onGrabDragEnd={onGrabDragEnd}
        onTabStripScroll={onInterruptReveal}
        revealBloom={Boolean(revealVenueId)}
        revealChecked={revealRecord}
        revealCheckedLate={revealRecordLate}
      />

      {/* Overview — identity, latest price, add-to-crawl, "I'm here tonight". */}
      <VenueOverviewTab
        venue={venue}
        tab={tab}
        cityId={cityId}
        mode={mode}
        inCrawl={inCrawl}
        latestContributorPrice={latestContributorPrice}
        latestPintDropAt={latestPintDropAt}
        communityPrices={communityPrices}
        experienceLens={experienceLens}
        drinkLensCategory={drinkLensCategory}
        onToggleStop={onToggleStop}
        presenceState={presenceState}
        markPresenceHere={markPresenceHere}
        userLocation={userLocation}
        locationRequestStatus={locationRequestStatus}
        onRequestLocation={onRequestLocation}
        onClearLocation={onClearLocation}
        onLogTonightPrice={requestPriceEntry}
        onStartFirstDrop={startPintDrop}
        onOpenVisitReports={() => selectTab("story")}
        priceEntryAllowed={!authConfigured || Boolean(user && handle)}
        priceSignInRequested={priceSignInVenueId === venue.id}
        priceAuthLoading={authLoading}
        priceFocusRequest={
          priceFocusRequest.venueId === venue.id
            ? priceFocusRequest.count
            : 0
        }
        zoneIndex={zoneIndex}
        onLogged={onLogged}
        priceRevealMotionClass={priceRevealMotionClass}
        revealRecord={revealRecord}
        revealRecordLate={revealRecordLate}
      />

      {/* Photos — the pub's community wall. */}
      <VenuePhotosTab venue={venue} tab={tab} />

      {/* Pints — the primary tab: demo note, drops list, composer / log bar. */}
      {pubVenue ? (
        <VenuePintsTab
          venue={venue}
          tab={tab}
          pintDrops={pintDrops}
          drops={drops}
          lastTrainDecision={lastTrainDecision}
          onTabSelect={onTabSelect}
        />
      ) : null}

      <VenueMenuTab
        venue={venue}
        tab={tab}
        onAddDrink={pubVenue ? startPintDrop : undefined}
      />

      {/* Story — description / heritage note + provenance-stamped claims. */}
      <VenueStoryTab
        venue={venue}
        tab={tab}
        drops={drops}
        cityId={cityId}
        cityLandmarks={cityLandmarks}
        cityStoryBands={cityStoryBands}
        cityCuratedCrawls={cityCuratedCrawls}
        revealRecord={revealRecord}
        revealRecordLate={revealRecordLate}
      />

      {/* Ask — the grounded "Ask the PUBMAXXER" landlord guide. */}
      <VenueAskTab venue={venue} tab={tab} />

      {/* Getting home — the nearest station + last trains tonight (TfL), so you
          know when to head off for the last drink. */}
      <VenueGettingHomeTab
        venue={venue}
        tab={tab}
        cityId={cityId}
        onSelectVenue={onSelectVenue}
        onDecision={setLastTrainDecision}
      />

      {/* Venue command bar. On phones it moves into the shared sheet footer;
          on desktop it stays pinned at the bottom of this inspector. */}
      <VenueStickyBar
        venue={venue}
        mode={mode}
        inCrawl={inCrawl}
        onToggleStop={onToggleStop}
        onAcceptStop1={onAcceptStop1}
        acceptanceError={acceptanceError}
        onAddPrice={requestPriceEntry}
        shareVenue={shareVenue}
        currentShareFeedback={currentShareFeedback}
      />
      {priceOnboardingOpen ? (
        <ContributionGateDialog
          mode="onboarding_required"
          error={null}
          onClose={() => setPriceOnboardingOpen(false)}
        />
      ) : null}
    </section>
  );
}
