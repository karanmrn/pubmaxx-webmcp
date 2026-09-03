"use client";

import Link from "next/link";
import { Ellipsis, GlassWater, LocateFixed, LocateOff, MoonStar, Route, Search, SlidersHorizontal, TrainFront, X } from "lucide-react";
import { lazy, Suspense } from "react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import CitySwitcher from "@/components/map/CitySwitcher";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import { buildFiltersChip, buildNearMeChip, buildTflCorner, buildTonightChip, type CornerUtilityModel, type PrimaryChipModel, type TonightChipModel } from "@/lib/mapChromeTiers";
import { MAP_SHEET_TITLES, type MapOverlay, type MapSheetKind } from "@/lib/mobileShell";
import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";

import "./mobileMapShell.css";

import type { MapSearchSuggestProps } from "@/components/map/MapSearchSuggest";

const MapSearchSuggest = lazy(() => import("@/components/map/MapSearchSuggest"));

const CONTEXTUAL_SHEETS: readonly MapSheetKind[] = [
  "filters",
  "drink",
  "tfl",
  "tonight",
  "layers",
  "pub-pal",
  "moment",
  "near-me",
  "area",
  "choose-area",
];

/**
 * The map edge, top to bottom: TfL at the top, Near me at the thumb.
 *
 * Near me is a round FAB rather than a bar chip because that is what a map
 * reader already knows a locate control looks like, and because the one top
 * bar has no room left at 320px (design judgement 2026-08-01, finding 2.3).
 * Its state stays in the accessible name: "Near me", "Locating", "Nearby 12",
 * "Try near me".
 */
function MapEdgeControls({
  tfl,
  tflOpen,
  onOpenTfl,
  nearMe,
  nearbyCount,
  onNearMe,
}: {
  tfl: CornerUtilityModel;
  tflOpen: boolean;
  onOpenTfl: () => void;
  nearMe: PrimaryChipModel;
  nearbyCount: number;
  onNearMe: () => void;
}) {
  return (
    <div className="mobileMapUtilityCorner" aria-label="Map utilities">
      <IconButton className="mobileMapTflButton" aria-label={tfl.ariaLabel} aria-expanded={tflOpen} onClick={onOpenTfl}>
        <TrainFront size={19} />
        {tfl.statusSuffix ? <span className="mobileMapCornerSuffix" aria-hidden="true">{tfl.statusSuffix}</span> : null}
        {tfl.badge ? <span className="mobileMapCornerBadge">{tfl.badge}</span> : null}
      </IconButton>
      <button
        type="button"
        className="mobileMapLocateFab"
        aria-label={nearMe.label}
        aria-pressed={nearMe.pressed}
        disabled={nearMe.disabled}
        onClick={onNearMe}
      >
        <LocateFixed size={20} aria-hidden="true" />
        {nearMe.pressed && nearbyCount ? (
          <span className="mobileMapCornerBadge" aria-hidden="true">{nearbyCount}</span>
        ) : null}
      </button>
    </div>
  );
}

/**
 * Which sheet this shell should MOUNT, which is a narrower question than which
 * overlay is open. Above the phone breakpoint the portal is display:none, but a
 * mounted sheet still claims Escape on `window` and still captures and restores
 * focus, and CSS reaches neither - so a shell that does not own the lane mounts
 * nothing at all rather than mounting something invisible.
 */
function contextualSheetKind(
  overlay: MapOverlay,
  enabled: boolean,
): MapSheetKind | null {
  if (!enabled) return null;
  return CONTEXTUAL_SHEETS.includes(overlay as MapSheetKind)
    ? (overlay as MapSheetKind)
    : null;
}

/** The sheets that open at full height; every other kind opens at half. */
const FULL_HEIGHT_SHEETS: readonly MapSheetKind[] = [
  "moment",
  "layers",
  "near-me",
  "area",
  "choose-area",
];

/** Which body belongs to which sheet kind. Pal is the fall-through. */
function sheetBodyFor(
  kind: MapSheetKind | null,
  bodies: Partial<Record<MapSheetKind, React.ReactNode>> & {
    "pub-pal": React.ReactNode;
  },
): React.ReactNode {
  if (!kind) return bodies["pub-pal"];
  return kind in bodies ? bodies[kind] : bodies["pub-pal"];
}

/**
 * ONE docked lane under the one bar, shared by both chips, so the phone chrome
 * still costs a bar plus a single 44px row however many chips it earns.
 *
 * Left: the drink the map is under, always named, because a map showing
 * cocktail prices must never look like the pint map and that choice may not be
 * buried two taps inside a refinement drawer.
 * Right (P5 cold-start): What's On listings earn a one-tap path into the
 * Tonight sheet, and a quiet night simply leaves that half empty.
 *
 * The row stops short of the published map-edge lane so TfL never swallows a
 * chip's taps (components/mobile/mobileMapShell.css).
 */
function MapChipRow({
  overlay,
  drinkLaneLabel,
  drinkLaneSelected,
  tonightChip,
  onOpen,
}: {
  overlay: MapOverlay;
  drinkLaneLabel: string;
  drinkLaneSelected: boolean;
  tonightChip: TonightChipModel | null;
  onOpen: (overlay: MapOverlay) => void;
}) {
  const drinkOpen = overlay === "drink";
  const tonightOpen = overlay === "tonight";
  return (
    <div className="mobileMapChipRow">
      <button
        type="button"
        className={
          drinkOpen || drinkLaneSelected
            ? "mobileMapDrinkChip isActive"
            : "mobileMapDrinkChip"
        }
        aria-label={`Drink shown on the map: ${drinkLaneLabel}. Choose another drink`}
        aria-expanded={drinkOpen}
        aria-haspopup="dialog"
        onClick={() => onOpen("drink")}
      >
        <GlassWater size={15} aria-hidden="true" />
        <span className="mobileMapDrinkChipLabel">{drinkLaneLabel}</span>
      </button>
      {tonightChip ? (
        <button
          type="button"
          className={
            tonightOpen ? "mobileMapTonightChip isActive" : "mobileMapTonightChip"
          }
          aria-label={tonightChip.ariaLabel}
          aria-expanded={tonightOpen}
          aria-pressed={tonightOpen}
          onClick={() => onOpen("tonight")}
        >
          <MoonStar size={15} aria-hidden="true" />
          <span className="mobileMapTonightChipLabel">{tonightChip.label}</span>
          <span className="mobileMapTonightChipCount" aria-hidden="true">
            {tonightChip.count}
          </span>
        </button>
      ) : null}
    </div>
  );
}

export default function MobileMapShell({ cityId = DEFAULT_CITY_ID, cityLabel, limitedCoverage, interactionLocked = false, overlay, onOverlayChange, backLabel, onBack, onHome, activeQuery, onClearQuery, onNearMe, nearMeStatus, nearMeError, onDismissNearMeError, nearbyCount, tonightCount, tonightNearReader, tflCount, tflStatus, priceLabel, drinkFiltersActive, drinkLaneLabel, drinkLaneSelected, experienceFilterLabel, priceCapActive, zoneActive, savedOnlyActive = false, openNowActive, planOpen, planActive, planStopCount, planInteractive, venueListOpen, bandNoticeOpen, onPlan, searchProps, searchContent, filtersContent, drinkContent, tflContent, tonightContent, layersContent, palContent, momentContent, nearMeContent, areaContent, chooseAreaContent, sheetsEnabled = true }: {
  cityId?: CityId;
  cityLabel: string;
  /** Base-pub-only arrival: omit city-guide controls that cannot answer here. */
  limitedCoverage: boolean;
  /** First-visit choice owns focus and taps until it is dismissed or answered. */
  interactionLocked?: boolean;
  overlay: MapOverlay;
  onOverlayChange: (overlay: MapOverlay) => void;
  /**
   * The way out, shared with every other surface in the product. Back returns
   * to the sheet that opened this one; Home leaves them all for the map. Back
   * is null when this sheet opened over the map, where the two are the same
   * journey (components/ui/surface-nav.tsx).
   */
  backLabel: string | null;
  onBack: () => void;
  onHome: () => void;
  /** #395 R1: the live map search query (restored or typed), trimmed. Empty = no filter. */
  activeQuery: string;
  /** Clears the query and unfilters the map. */
  onClearQuery: () => void;
  onNearMe: () => void;
  nearMeStatus: "idle" | "requesting" | "ready" | "error";
  /** Why Near me could not place the reader. Null while it can, or has not run. */
  nearMeError: string | null;
  /** Clears that message, so the map is never left holding a stale reason. */
  onDismissNearMeError: () => void;
  nearbyCount: number;
  /**
   * What's On listings ready for the phone cold-start chip. Zero (or a quiet
   * night) keeps the chip off the map; a positive count opens overlay "tonight".
   */
  tonightCount: number;
  /**
   * Whether that count was fetched with a reader location (the /api/whats-on
   * near= seam). City-wide cold-start must not claim "near you".
   */
  tonightNearReader: boolean;
  tflCount: number;
  tflStatus: "checking" | "clear" | "issues" | "unavailable";
  priceLabel: string;
  drinkFiltersActive: boolean;
  /** The drink the map is under, as the lane chip prints it ("Pints"). */
  drinkLaneLabel: string;
  /** False for the resting pint lane, so the chip only marks a real choice. */
  drinkLaneSelected: boolean;
  experienceFilterLabel?: "no-alcohol view" | "food view";
  /** #329 zone lens counts as a filters refinement (its mobile home is the filters sheet). */
  zoneActive?: boolean;
  /** Saved only on the Filters sheet — same field as the desktop ControlRail. */
  savedOnlyActive?: boolean;
  /** Open now filter counts as a filters refinement when on. */
  openNowActive?: boolean;
  priceCapActive: boolean;
  planOpen: boolean;
  planActive: boolean;
  planStopCount: number;
  planInteractive: boolean;
  venueListOpen: boolean;
  bandNoticeOpen: boolean;
  onPlan: () => void;
  searchProps?: MapSearchSuggestProps | null;
  /** Legacy injection seam retained for isolated shell tests and callers. */
  searchContent?: React.ReactNode;
  filtersContent: React.ReactNode;
  /** The drink-lane picker body. Its own sheet, never a Filters section. */
  drinkContent: React.ReactNode;
  tflContent: React.ReactNode;
  tonightContent: React.ReactNode;
  layersContent: React.ReactNode;
  palContent: React.ReactNode;
  momentContent: React.ReactNode;
  nearMeContent: React.ReactNode;
  /** The Area sheet body (cheapest pints here + go somewhere else). */
  areaContent: React.ReactNode;
  /** First-visit choose-area picker (London neighbourhoods + other cities). */
  chooseAreaContent: React.ReactNode;
  /**
   * Whether this shell owns the sheet lane. The portal is display:none above
   * the phone breakpoint, but a MOUNTED sheet still claims Escape on `window`
   * and still captures and restores focus, and CSS cannot reach either. Every
   * overlay used to be settable from phone chrome alone, so it never showed;
   * `choose-area` is the first one a desktop control opens, and there the phone
   * sheet answered the same Escape as the desktop dialog and sent the surface
   * trail Home behind it. One Escape, one level (lib/useDismissOnEscape.ts).
   */
  sheetsEnabled?: boolean;
}) {
  // The glyph is half the claim. LocateFixed is this map's "you are here" mark
  // (the Near me chip wears it), so it may appear only when a granted location
  // sits inside the named area. Otherwise the chip wears the map itself.
  if (limitedCoverage) {
    const setLimitedOverlay = (next: MapOverlay) =>
      onOverlayChange(overlay === next ? "none" : next);

    return (
      <div
        className="mobileMapChrome"
        aria-label="Map controls"
        inert={interactionLocked || undefined}
      >
        <header className="mobileMapTopbar mobileMapTopbarLimited">
          <Link href="/" className="mobileMapBrand" aria-label="Open PUBMAXX landing page">
            <PubmaxxWordmark />
          </Link>
          <CitySwitcher
            cityId={cityId}
            triggerLabel={cityLabel}
            className="citySwitcher--mobile"
            onUseMyLocation={onNearMe}
          />
          <IconButton
            aria-label="Search the map"
            aria-expanded={overlay === "search"}
            onClick={() => setLimitedOverlay("search")}
          >
            <Search size={19} />
          </IconButton>
        </header>
        {overlay === "search" ? (
          <div className="mobileMapSearchRow">
            {searchProps ? (
              <Suspense fallback={null}>
                <MapSearchSuggest {...searchProps} />
              </Suspense>
            ) : searchContent}
          </div>
        ) : null}
      </div>
    );
  }

  const set = (next: MapOverlay) => onOverlayChange(overlay === next ? "none" : next);
  const nearMe = buildNearMeChip(nearMeStatus, nearbyCount);
  const filtersChip = buildFiltersChip({
    drinkFiltersActive,
    experienceLabel: experienceFilterLabel,
    priceCapActive,
    priceLabel,
    zoneActive,
    savedOnlyActive,
    openNowActive,
  });
  const tflCorner = buildTflCorner(tflStatus, tflCount);
  const tonightChip = buildTonightChip(tonightCount, tonightNearReader);
  const sheetKind = contextualSheetKind(overlay, sheetsEnabled);
  const sheetContent = sheetBodyFor(sheetKind, {
    filters: filtersContent,
    drink: drinkContent,
    tfl: tflContent,
    tonight: tonightContent,
    layers: layersContent,
    moment: momentContent,
    "near-me": nearMeContent,
    area: areaContent,
    "choose-area": chooseAreaContent,
    "pub-pal": palContent,
  });

  return (
    <>
      <div className="mobileMapChrome"
        aria-label="Map controls"
        inert={interactionLocked || undefined}
      >
        {/* ONE top bar (design judgement 2026-08-01, finding 2.3). The old
            chrome stacked three containers: this bar, a Near me / Tonight /
            Filters rail, and a full-width category row. The category toggles
            now live in the Filters sheet beside "Show me", Near me is a round
            map-edge FAB, and Tonight does not reclaim a sixth bar slot. When
            What's On has listings, a cold-start chip docks under the bar and
            opens overlay "tonight" in one tap; More → Events and the tab bar
            stay as homes. Six slots is what 320px holds at the 44px tap floor,
            so the bar cannot grow again in silence. */}
        <header className="mobileMapTopbar">
          <Link href="/" className="mobileMapBrand" aria-label="Open PUBMAXX landing page"><PubmaxxWordmark /></Link>
          <CitySwitcher
            cityId={cityId}
            triggerLabel={cityLabel}
            className="citySwitcher--mobile"
            onUseMyLocation={onNearMe}
            onOpenArea={() => set("choose-area")}
          />
          <IconButton aria-label="Search the map" aria-expanded={overlay === "search"} onClick={() => set("search")}><Search size={19} /></IconButton>
          <IconButton
            className="mobileMapFiltersButton"
            aria-label={filtersChip.ariaLabel}
            aria-expanded={overlay === "filters"}
            onClick={() => set("filters")}
          >
            <SlidersHorizontal size={19} />
            {/* The badge counts refinements. The accessible name already names
                them, so the glyph is decorative. */}
            {filtersChip.refinements ? (
              <span className="mobileMapTopbarBadge" aria-hidden="true">{filtersChip.refinements}</span>
            ) : null}
          </IconButton>
          <IconButton aria-label="More map controls" aria-expanded={overlay === "layers"} onClick={() => set("layers")}><Ellipsis size={20} /></IconButton>
        </header>

        {overlay === "search" ? (
          <div className="mobileMapSearchRow">
            {searchProps ? (
              <Suspense fallback={null}>
                <MapSearchSuggest {...searchProps} />
              </Suspense>
            ) : searchContent}
          </div>
        ) : null}
        {/* #395 R1 — active-search chip. When a query filters the map (restored
            session OR typed) and the search field is closed, surface it as a
            dismissible chip so the filter is never invisible. Tapping it clears
            the query and restores every pin. */}
        {overlay !== "search" && activeQuery ? (
          <div className="mobileMapQueryRow">
            <button
              type="button"
              className="mobileMapQueryChip"
              onClick={onClearQuery}
              aria-label={`Clear pub search: ${activeQuery}`}
            >
              <Search size={15} aria-hidden="true" />
              <span className="mobileMapQueryChipText">{activeQuery}</span>
              <X size={16} aria-hidden="true" className="mobileMapQueryChipDismiss" />
            </button>
          </div>
        ) : null}
        {overlay === "search" ? null : (
          <MapChipRow
            overlay={overlay}
            drinkLaneLabel={drinkLaneLabel}
            drinkLaneSelected={drinkLaneSelected}
            tonightChip={tonightChip}
            onOpen={set}
          />
        )}
      </div>
      {/* Near me failed. The control alone says "Try near me", which names no
          reason and offers no way on, so the reason docks under the one top
          bar, with the area picker one tap away. role="alert" announces it,
          the same as the desktop rail does. */}
      {overlay !== "search" && nearMeError ? (
        <div className="mobileMapNearMeAlert" role="alert">
          <LocateOff size={17} aria-hidden="true" />
          <p className="mobileMapNearMeAlertText">{nearMeError}</p>
          <button
            type="button"
            className="mobileMapNearMeAlertDismiss"
            aria-label="Dismiss the Near me message"
            onClick={onDismissNearMeError}
          >
            <X size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobileMapNearMeAlertArea"
            onClick={() => {
              onDismissNearMeError();
              onOverlayChange("choose-area");
            }}
          >
            Pick an area
          </button>
        </div>
      ) : null}
      {/* The map edge, top to bottom: TfL at the top, Near me at the thumb.
          Near me is a round FAB rather than a bar chip because that is what a
          map reader already knows a locate control looks like, and because the
          bar has no room left at 320px. Its state stays in the accessible
          name ("Near me", "Locating", "Nearby 12", "Try near me"). */}
      {overlay !== "search" ? (
        <MapEdgeControls
          tfl={tflCorner}
          tflOpen={overlay === "tfl"}
          onOpenTfl={() => set("tfl")}
          nearMe={nearMe}
          nearbyCount={nearbyCount}
          onNearMe={onNearMe}
        />
      ) : null}
      {overlay === "none" && !planOpen && !venueListOpen && !bandNoticeOpen ? (
        <button
          type="button"
          className={`mobilePlanActivation${planActive ? " isActive" : ""}`}
          aria-label={planActive ? `Edit active ${planStopCount}-stop plan` : "Describe the outing"}
          disabled={!planInteractive}
          onClick={onPlan}
        >
          <Route size={19} aria-hidden="true" />
          <span>
            <strong>{planActive ? `${planStopCount}-stop plan` : "Describe the outing"}</strong>
            {planActive ? <small>Edit route</small> : null}
          </span>
        </button>
      ) : null}
      <Sheet kind={sheetKind} title={sheetKind ? MAP_SHEET_TITLES[sheetKind] ?? "Map controls" : "Map controls"} initialSnap={sheetKind && FULL_HEIGHT_SHEETS.includes(sheetKind) ? "full" : "half"} onClose={onHome} backLabel={backLabel} onBack={onBack}>{sheetContent}</Sheet>
    </>
  );
}
