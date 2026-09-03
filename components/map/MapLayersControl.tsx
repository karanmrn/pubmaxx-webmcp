"use client";

// Corner Layers control — all viewports (Wave J declutter). Keeps Tube/Parks/
// story bands out of the mid-map strip; opens a compact popover.

import { Layers, List, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import {
  POI_TOGGLE_GROUPS,
  isPoiGroupOn,
  poiGroupToggleChange,
  type PoiHiddenChange,
  type PoiToggleGroup,
} from "@/lib/poiToggleGroups";
import type { PoiCategory } from "@/lib/pois";
import type { StoryBand } from "@/lib/storyBands";

import "./mapLayersControl.css";

/** City-aware Layers chrome — transit framing without Tube-first copy elsewhere. */
export function mapLayersCopy(cityId: CityId = DEFAULT_CITY_ID): {
  ariaLabelClosed: string;
  title: string;
  hint: string;
} {
  switch (cityId) {
    case "london":
      return {
        ariaLabelClosed: "Map layers: Tube, Rail, parks, and place stories",
        title: "Tube, Rail, parks & place stories",
        hint: "Tube, Rail, parks, and story corridors. Switch them on when you want them.",
      };
    case "manchester":
      return {
        ariaLabelClosed: "Map layers: Tram, parks, landmarks, and place stories",
        title: "Tram, parks, landmarks & place stories",
        hint: "Tram, parks, landmarks, and story corridors. Switch them on when you want them.",
      };
    case "glasgow":
      return {
        ariaLabelClosed: "Map layers: Subway, parks, landmarks, and place stories",
        title: "Subway, parks, landmarks & place stories",
        hint: "Subway, parks, landmarks, and story corridors. Switch them on when you want them.",
      };
    case "liverpool":
      return {
        ariaLabelClosed: "Map layers: Rail, parks, landmarks, and place stories",
        title: "Rail, parks, landmarks & place stories",
        hint: "Rail, parks, landmarks, and story corridors. Switch them on when you want them.",
      };
    default:
      return {
        ariaLabelClosed: "Map layers: parks, landmarks, and place stories",
        title: "Parks, landmarks & place stories",
        hint: "Parks, landmarks, and story corridors. Switch them on when you want them.",
      };
  }
}

type MapLayersControlProps = {
  poiHidden: Record<PoiCategory, boolean>;
  onPoiHiddenChange: (next: PoiHiddenChange) => void;
  activeBandId?: string;
  onBandChange?: (bandId: string) => void;
  /** City Place-story corridors; defaults to London STORY_BANDS. */
  storyBands?: StoryBand[];
  /** City id for transit-aware aria/title/hint copy. Defaults to london. */
  cityId?: CityId;
  embedded?: boolean;
  onRequestClose?: () => void;
  /** Price key lives here so it does not float over the pins. */
  readerKey?: ReactNode;
  /**
   * Max pint price cap. Same rule as the key: a reader control, not chrome.
   * A render prop, because picking a cap closes this popover the way the
   * retired corner control closed its own panel.
   */
  readerPriceFilter?: (close: () => void) => ReactNode;
  listOpen?: boolean;
  onListOpenChange?: (open: boolean) => void;
  listCount?: number;
};

export default function MapLayersControl({
  poiHidden,
  onPoiHiddenChange,
  activeBandId = "",
  onBandChange,
  storyBands = [],
  cityId = DEFAULT_CITY_ID,
  embedded = false,
  onRequestClose,
  readerKey,
  readerPriceFilter,
  listOpen = false,
  onListOpenChange,
  listCount = 0,
}: MapLayersControlProps) {
  // Deep-link `?band=` opens Layers without an effect: bandForcesOpen until the
  // user dismisses for that band id (Wave J removed mid-map band picker).
  const [manualOpen, setManualOpen] = useState(false);
  const [closedForBandId, setClosedForBandId] = useState<string | null>(null);
  const bandForcesOpen = Boolean(activeBandId) && closedForBandId !== activeBandId;
  const open = embedded || manualOpen || bandForcesOpen;
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const layersCopy = mapLayersCopy(cityId);

  function closePanel() {
    if (embedded) {
      onRequestClose?.();
      return;
    }
    setManualOpen(false);
    if (activeBandId) setClosedForBandId(activeBandId);
  }

  function openPanel() {
    setManualOpen(true);
    setClosedForBandId(null);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Claim the key so the map-level Escape (close drawer) doesn't also fire.
        event.preventDefault();
        closePanel();
      }
    }
    function onPointer(event: MouseEvent | TouchEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        closePanel();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("touchstart", onPointer, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("touchstart", onPointer);
    };
    // closePanel closes over activeBandId; rebind when open/band changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional close capture
  }, [open, activeBandId]);

  // Updater form, never a snapshot: quick successive taps otherwise race the
  // owner's re-render and each new toggle reverts the one before it.
  function toggleGroup(group: PoiToggleGroup) {
    onPoiHiddenChange(poiGroupToggleChange(group));
  }

  const storiesActive = Boolean(activeBandId);

  return (
    <div
      className={open ? "mapLayersControl isOpen" : "mapLayersControl"}
      ref={rootRef}
    >
      {!embedded ? <button
        type="button"
        className={
          open || storiesActive ? "mapLayersFab isActive" : "mapLayersFab"
        }
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close map layers" : layersCopy.ariaLabelClosed}
        title={layersCopy.title}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <Layers size={18} aria-hidden="true" />
        <span>Layers</span>
      </button> : null}

      {open ? (
        <div
          id={panelId}
          className="mapLayersPanel"
          role={embedded ? "group" : "dialog"}
          aria-label="Map layers"
        >
          <div className="mapLayersPanelHead">
            <strong>Map layers</strong>
            {!embedded ? <button
              type="button"
              className="mapLayersClose"
              aria-label="Close layers"
              onClick={closePanel}
            >
              <X size={16} aria-hidden="true" />
            </button> : null}
          </div>

          <p className="mapLayersHint">{layersCopy.hint}</p>

          {readerKey || readerPriceFilter || onListOpenChange ? (
            <div className="mapLayersReader">
              {onListOpenChange ? (
                <button
                  type="button"
                  className={listOpen ? "mapLayersReaderAction isOn" : "mapLayersReaderAction"}
                  aria-pressed={listOpen}
                  onClick={() => {
                    const next = !listOpen;
                    closePanel();
                    onListOpenChange(next);
                  }}
                >
                  <List size={16} aria-hidden="true" />
                  <span>{listOpen ? "Hide venue list" : "List view"}</span>
                  {listCount > 0 ? (
                    <span className="mapLayersReaderCount">{listCount}</span>
                  ) : null}
                </button>
              ) : null}
              {readerKey ? (
                <div className="mapLayersReaderKey">{readerKey}</div>
              ) : null}
              {readerPriceFilter?.(closePanel)}
            </div>
          ) : null}

          <div className="mapLayersGroup" role="group" aria-label="Points of interest">
            {POI_TOGGLE_GROUPS.map((group) => {
              const on = isPoiGroupOn(poiHidden, group);
              return (
                <button
                  key={group.id}
                  type="button"
                  className={on ? "mapLayersChip isOn" : "mapLayersChip"}
                  aria-pressed={on}
                  onClick={() => toggleGroup(group)}
                >
                  <span className="mapLayersSwatch" style={{ background: group.color }} />
                  {group.label}
                </button>
              );
            })}
          </div>

          {onBandChange ? (
            <div className="mapLayersStories" role="group" aria-label="Place stories">
              <p className="mapLayersSectionLabel">Place stories</p>
              <div className="mapLayersBandRow">
                {storyBands.map((band) => {
                  const on = activeBandId === band.id;
                  return (
                    <button
                      key={band.id}
                      type="button"
                      className={on ? "mapLayersChip isOn" : "mapLayersChip"}
                      aria-pressed={on}
                      title={band.copy}
                      onClick={() => {
                        setClosedForBandId(null);
                        onBandChange(on ? "" : band.id);
                      }}
                    >
                      {band.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
