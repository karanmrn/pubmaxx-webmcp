"use client";

// W1/W2 Tonight lane — the map-home surface for the PRIMARY What's-On spine
// (/api/whats-on, venueId-joined quiz/sport/deal/music on tonight). A
// compact top chip keeps the map clear by default; on demand it opens a
// horizontally scrollable row of 3–5 nearby cards with kind filter chips.
// Cards deep-link into the venue sheet (onSelectVenue) and carry a plan
// affordance (/plan?src=tonight-lane) so lane→plan conversions are attributable.
// Provenance ("Screens live sport" / source-listed time evidence + "Checked
// <date>" + source label) rides every card. Exact clocks and urgency appear
// only when the source supplied a firm start.
//
// Prop-driven: PubMap owns the fetch (useWhatsOnTonight) and the map wiring;
// this component is pure presentation over rows it is handed. Renders nothing
// when there are no tonight rows (honest empty), so the map is never cluttered
// on a quiet night.

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, MapPin, MoonStar, Tv, X } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import type { WhatsOnKind, WhatsOnRow } from "@/lib/whatsOn";
import { WhatsOnUrgencyBadge } from "@/components/map/WhatsOnUrgencyBadge";
import {
  dealEndsCaption,
  dealListingAgeCaption,
  dealProximityAnchor,
  orderDealsInPlace,
} from "@/lib/dealsHonesty";
import {
  checkedLabel,
  filterLaneRows,
  laneCardsFromRows,
  laneKindFacets,
} from "@/lib/whatsOnBadges";


type TonightLaneProps = {
  rows: WhatsOnRow[];
  asOf: string | null;
  /** Spine load status — "error" renders an honest "unavailable" pill. */
  status?: "idle" | "ready" | "empty" | "error";
  onSelectVenue: (venueId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Viewer location for "~N min walk" on cards (haversine; optional). */
  near?: { lat: number; lng: number } | null;
  /** Garden/weather cue from tonight-conditions when relevant. */
  gardenCue?: string | null;
  /** Deep-link kind filter (e.g. map ?src=whats-on-deal). */
  initialKind?: WhatsOnKind | null;
  /** Secondary CityMCP opportunity-pin overlay, folded into this top chrome. */
  overlayCount?: number;
  overlayActive?: boolean;
  onToggleOverlay?: () => void;
  onDismissOverlay?: () => void;
  /**
   * "map" (default) floats the lane at the map edge (absolute, translated,
   * viewport-width math) with its own collapse affordance. "sheet" renders the
   * same lane content in-flow inside a bottom sheet whose own header owns the
   * single close affordance — so the map-edge chrome (absolute positioning,
   * duplicate close ×) never leaks into the sheet portal.
   */
  variant?: "map" | "sheet";
};

export default function TonightLane({
  rows,
  asOf,
  status = "idle",
  onSelectVenue,
  open,
  onOpenChange,
  near = null,
  gardenCue = null,
  initialKind = null,
  overlayCount = 0,
  overlayActive = false,
  onToggleOverlay,
  onDismissOverlay,
  variant = "map",
}: TonightLaneProps) {
  const inSheet = variant === "sheet";
  const [activeKind, setActiveKind] = useState<WhatsOnKind | null>(initialKind);
  // Deep-link kind changes (e.g. /map?src=whats-on-deal) reset the chip during
  // render — React's documented prop→state sync, no effect setState.
  const [prevInitialKind, setPrevInitialKind] = useState(initialKind);
  if (initialKind !== prevInitialKind) {
    setPrevInitialKind(initialKind);
    if (initialKind) setActiveKind(initialKind);
  }
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const toggleOverlay = overlayCount > 0 ? onToggleOverlay : undefined;

  const changeOpen = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const facets = useMemo(() => laneKindFacets(rows), [rows]);
  const nearLat = near?.lat ?? null;
  const nearLng = near?.lng ?? null;
  const cards = useMemo(
    () => {
      const laneRows = filterLaneRows(rows, activeKind);
      // Deals order among themselves: nearest patch first, then closing soonest.
      // In place, so the unfiltered lane keeps every other kind exactly where the
      // spine put it, and the Deal chip gets the full deal order for free.
      const ordered = orderDealsInPlace(
        laneRows,
        (row) => row,
        dealProximityAnchor(
          nearLat != null && nearLng != null ? { lat: nearLat, lng: nearLng } : null,
        ),
      );
      return laneCardsFromRows(ordered, {
        limit: 5,
        near:
          nearLat != null && nearLng != null
            ? { lat: nearLat, lng: nearLng }
            : null,
      });
    },
    [rows, activeKind, nearLat, nearLng],
  );
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  // Honest outage state: the PRIMARY spine failed — say so quietly instead of
  // pretending it's a quiet night. Badges are simply absent in this state.
  if (status === "error" && !toggleOverlay) {
    return <TonightErrorState inSheet={inSheet} />;
  }

  if (rows.length === 0 && !toggleOverlay) {
    // In-sheet the viewer explicitly opened Tonight, so an empty portal reads as
    // broken — say quietly that nothing is on rather than rendering nothing.
    if (inSheet) {
      return <TonightLaneEmptySheet />;
    }
    return null;
  }

  if (!isOpen) {
    return (
      <TonightLaneCollapsed
        rows={rows}
        asOf={asOf}
        status={status}
        toggleOverlay={toggleOverlay}
        overlayCount={overlayCount}
        overlayActive={overlayActive}
        onDismissOverlay={onDismissOverlay}
        onOpen={() => changeOpen(true)}
      />
    );
  }

  return (
    <TonightLaneOpen
      inSheet={inSheet}
      asOf={asOf}
      gardenCue={gardenCue}
      toggleOverlay={toggleOverlay}
      overlayCount={overlayCount}
      overlayActive={overlayActive}
      onDismissOverlay={onDismissOverlay}
      onCollapse={() => changeOpen(false)}
      facets={facets}
      activeKind={activeKind}
      onSetActiveKind={setActiveKind}
      cards={cards}
      rowsById={rowsById}
      onSelectVenue={onSelectVenue}
    />
  );
}

function TonightErrorState({ inSheet }: { inSheet: boolean }) {
  return (
    <section
      className={`tonightLane tonightLane--error${inSheet ? " tonightLane--sheet" : ""}`}
      aria-label="On tonight near you"
    >
      <div className="tonightLaneTitleRow" role="status">
        <div className="tonightLaneTitleMeta">
          <h2 className="tonightLaneTitle">On tonight</h2>
          <span className="tonightLaneChecked">
            Tonight&rsquo;s listings unavailable right now
          </span>
        </div>
      </div>
    </section>
  );
}

function TonightLaneEmptySheet() {
  return (
    <section
      className="tonightLane tonightLane--sheet tonightLane--open"
      aria-label="On tonight near you"
    >
      <p className="tonightLaneEmpty" role="status">
        Nothing listed on tonight near you right now.
      </p>
    </section>
  );
}

function TonightLaneCollapsed({
  rows,
  asOf,
  status,
  toggleOverlay,
  overlayCount,
  overlayActive,
  onDismissOverlay,
  onOpen,
}: {
  rows: WhatsOnRow[];
  asOf: string | null;
  status: "idle" | "ready" | "empty" | "error";
  toggleOverlay: (() => void) | undefined;
  overlayCount: number;
  overlayActive: boolean;
  onDismissOverlay?: () => void;
  onOpen: () => void;
}) {
  return (
    <section
      className="tonightLane tonightLane--collapsed"
      aria-label="On tonight near you"
    >
      <div className="tonightLaneCollapsed">
        {rows.length > 0 ? (
          <button
            type="button"
            className="tonightLaneCollapsedMain pressable"
            data-testid="tonight-lane-chip"
            aria-expanded={false}
            onClick={onOpen}
          >
            <span className="tonightLaneCollapsedTitle">
              On tonight <span aria-hidden="true">·</span> {rows.length}
            </span>
            <span className="tonightLaneCollapsedChecked">{checkedLabel(asOf)}</span>
          </button>
        ) : (
          <span className="tonightLaneCollapsedMain" role="status">
            <span className="tonightLaneCollapsedTitle">Tonight nearby</span>
            {status === "error" ? (
              <span className="tonightLaneCollapsedChecked">Listings unavailable</span>
            ) : null}
          </span>
        )}
        {toggleOverlay ? (
          <TonightOverlayToggle
            count={overlayCount}
            active={overlayActive}
            onToggle={toggleOverlay}
          />
        ) : null}
        {toggleOverlay && overlayActive && onDismissOverlay ? (
          <TonightOverlayDismiss onDismiss={onDismissOverlay} />
        ) : null}
      </div>
    </section>
  );
}

function TonightLaneOpen({
  inSheet,
  asOf,
  gardenCue,
  toggleOverlay,
  overlayCount,
  overlayActive,
  onDismissOverlay,
  onCollapse,
  facets,
  activeKind,
  onSetActiveKind,
  cards,
  rowsById,
  onSelectVenue,
}: {
  inSheet: boolean;
  asOf: string | null;
  gardenCue: string | null;
  toggleOverlay: (() => void) | undefined;
  overlayCount: number;
  overlayActive: boolean;
  onDismissOverlay?: () => void;
  onCollapse: () => void;
  facets: ReturnType<typeof laneKindFacets>;
  activeKind: WhatsOnKind | null;
  onSetActiveKind: (kind: WhatsOnKind | null) => void;
  cards: ReturnType<typeof laneCardsFromRows>;
  rowsById: Map<string, WhatsOnRow>;
  onSelectVenue: (venueId: string) => void;
}) {
  return (
    <section
      className={`tonightLane tonightLane--open${inSheet ? " tonightLane--sheet" : ""}`}
      aria-label="On tonight near you"
    >
      <div className="tonightLaneHead">
        <div className="tonightLaneTitleRow">
          <div className="tonightLaneTitleMeta">
            <h2 className="tonightLaneTitle">On tonight</h2>
            <span className="tonightLaneChecked">{checkedLabel(asOf)}</span>
            {gardenCue ? (
              <span className="tonightLaneGardenCue" data-testid="tonight-lane-garden-cue">
                {gardenCue}
              </span>
            ) : null}
          </div>
          <div className="tonightLaneTitleActions">
            {toggleOverlay ? (
              <>
                <TonightOverlayToggle
                  count={overlayCount}
                  active={overlayActive}
                  onToggle={toggleOverlay}
                />
                {/* In-sheet, the labeled Pins toggle is the only pins control:
                    toggling it off hides the overlay, so the bare dismiss × is
                    redundant and reads as a stray second close. */}
                {!inSheet && overlayActive && onDismissOverlay ? (
                  <TonightOverlayDismiss onDismiss={onDismissOverlay} />
                ) : null}
              </>
            ) : null}
            {/* The bottom sheet's own header owns the single close affordance;
                the lane-internal collapse × belongs only to the map-edge float. */}
            {!inSheet ? (
              <button
                type="button"
                className="tonightLaneClose pressable"
                aria-label="Collapse on tonight"
                onClick={onCollapse}
              >
                <X size={17} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        {facets.length > 1 ? (
          <div
            className="tonightLaneChips"
            role="group"
            aria-label="Filter tonight by kind"
          >
            <button
              type="button"
              className="tonightLaneChip"
              data-active={activeKind === null}
              aria-pressed={activeKind === null}
              onClick={() => {
                onSetActiveKind(null);
                trackEvent("whats_on_filter");
              }}
            >
              All
            </button>
            {facets.map((facet) => (
              <button
                key={facet.kind}
                type="button"
                className="tonightLaneChip"
                data-active={activeKind === facet.kind}
                data-kind={facet.kind}
                aria-pressed={activeKind === facet.kind}
                onClick={() => {
                  onSetActiveKind(facet.kind);
                  trackEvent("whats_on_filter");
                }}
              >
                {facet.label}
                <span className="tonightLaneChipCount">{facet.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ul className="tonightLaneScroll" data-testid="tonight-lane">
        {cards.map((card) => {
          const when = card.timeLabel ?? card.badgeLabel;
          const KindIcon = card.kind === "sport" ? Tv : CalendarClock;
          const sourceRow = rowsById.get(card.id);
          return (
            <li key={card.id} className="tonightLaneCard" data-kind={card.kind}>
              {card.venueId ? (
                <button
                  type="button"
                  className="tonightLaneCardTap pressable"
                  onClick={() => {
                    trackEvent("lane_card_tap");
                    onSelectVenue(card.venueId as string);
                  }}
                >
                  <TonightLaneCardBody card={card} when={when} KindIcon={KindIcon} sourceRow={sourceRow} />
                </button>
              ) : (
                <div className="tonightLaneCardTap">
                  <TonightLaneCardBody card={card} when={when} KindIcon={KindIcon} sourceRow={sourceRow} />
                </div>
              )}
              <Link
                href="/plan?src=tonight-lane"
                className="tonightLanePlan pressable"
                onClick={() => trackEvent("lane_card_tap")}
              >
                Plan a round
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TonightOverlayDismiss({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      className="tonightLaneOverlayDismiss pressable"
      aria-label="Dismiss tonight map pins"
      onClick={onDismiss}
    >
      <X size={15} aria-hidden="true" />
    </button>
  );
}

function TonightOverlayToggle({
  count,
  active,
  onToggle,
}: {
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="tonightLaneOverlayToggle pressable"
      data-testid="tonight-overlay-toggle"
      data-active={active}
      aria-label={active ? "Hide tonight on map" : "Show tonight on map"}
      aria-pressed={active}
      onClick={onToggle}
    >
      <MoonStar size={15} aria-hidden="true" />
      <span>Pins</span>
      <span className="tonightLaneOverlayCount" aria-hidden="true">
        {count}
      </span>
    </button>
  );
}

function TonightLaneCardBody({
  card,
  when,
  KindIcon,
  sourceRow,
}: {
  card: ReturnType<typeof laneCardsFromRows>[number];
  when: string;
  KindIcon: typeof Tv;
  sourceRow?: WhatsOnRow;
}) {
  // Deal rows carry an exact window and a listing date, so they say when they
  // close and how old the listing is. Both read straight off the row.
  const dealRow = sourceRow?.kind === "deal" ? sourceRow : undefined;
  const endsCaption = dealRow ? dealEndsCaption(dealRow) : null;
  const listingAge = dealRow ? dealListingAgeCaption(dealRow) : null;
  return (
    <>
      <div className="tonightLaneCardMeta">
        <span className="tonightLaneCardKind">
          <KindIcon size={12} aria-hidden="true" />
          {card.kindLabel}
        </span>
        {typeof card.priceGbp === "number" ? (
          <span className="tonightLaneCardPrice">£{card.priceGbp.toFixed(2)}</span>
        ) : null}
      </div>
      <p className="tonightLaneCardTitle">{card.title}</p>
      <p className="tonightLaneCardPlace">
        <MapPin size={12} aria-hidden="true" />
        <span>{card.placeName}</span>
        {card.walkLabel ? (
          <span className="tonightLaneCardWalk">{card.walkLabel}</span>
        ) : null}
      </p>
      <p className="tonightLaneCardWhen">
        <span>{when}</span>
        {endsCaption ? (
          <span className="tonightLaneCardEnds">{endsCaption}</span>
        ) : null}
        {sourceRow ? <WhatsOnUrgencyBadge row={sourceRow} /> : null}
      </p>
      <p className="tonightLaneCardSource">via {card.sourceLabel}</p>
      {listingAge ? (
        <p className="tonightLaneCardListingAge">{listingAge}</p>
      ) : null}
    </>
  );
}
