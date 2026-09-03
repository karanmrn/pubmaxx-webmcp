"use client";

import {
  Accessibility,
  Anchor,
  Beer,
  BookOpen,
  Camera,
  ExternalLink,
  Hand,
  Landmark,
  LocateFixed,
  MapPinned,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";

import { pubSources, writerProfile } from "@/lib/curation";
import { curatedCrawls as londonCuratedCrawls, type CuratedCrawl } from "@/lib/curatedCrawls";
import type { CityId } from "@/lib/cities";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { OPEN_NOW_FILTER_CAPTION } from "@/lib/openNow";
import {
  accessibilityFilterSummary,
  isKnownAccessibleToilet,
  isKnownSeatedService,
  isKnownStepFree,
} from "@/lib/venueAccessibility";
import {
  initialFilters,
  NO_PINT_PRICE_CAP,
  type CrawlMode,
  type CrawlStyle,
  type Filters,
  type Venue,
} from "@/lib/venues";
import { SAVED_ONLY_ARIA_LABEL } from "@/lib/savedOnlyFilter";

/** Re-export so existing ControlRail importers keep resolving the aria label. */
export { SAVED_ONLY_ARIA_LABEL };
/** Re-export so existing ControlRail importers keep resolving the default filters. */
export { initialFilters };
/** Re-export so existing ControlRail type importers keep resolving crawl mode. */
export type { CrawlMode } from "@/lib/venues";

/** City-aware search placeholder examples (neighbourhoods, not Tube jargon). */
export function citySearchPlaceholder(cityId: CityId, displayName: string): string {
  switch (cityId) {
    case "london":
      return "Search Shoreditch, Hackney, pub name…";
    case "manchester":
      return "Search Northern Quarter, Ancoats, pub name…";
    case "oxford":
      return "Search Jericho, Cowley, pub name…";
    case "glasgow":
      return "Search West End, Merchant City, pub name…";
    case "liverpool":
      return "Search Baltic Triangle, Ropewalks, pub name…";
    case "bristol":
      return "Search Harbourside, Stokes Croft, pub name…";
    case "cambridge":
      return "Search Mill Road, Castle, pub name…";
    case "durham":
      return "Search Bailey, Claypath, pub name…";
    case "bath":
      return "Search Widcombe, Walcot, pub name…";
    case "llandudno":
      return "Search Conwy, Colwyn Bay, pub name…";
    default:
      return `Search ${displayName} neighbourhood, pub name…`;
  }
}

import "./accessibilityFilters.css";
// Map-scoped colour polish (D3): POI-toggle swatch rings + the documented,
// unwired pin-by-category paint patch. Imported here (map chrome, non-hot) so
// the rules load with the map without touching the codex-hot canvas.
import "./mapColor.css";

export const styleLabels: Record<CrawlStyle, string> = {
  balanced: "Balanced",
  noAlcoholFirst: "Alcohol-free first",
  cheapest: "Cheapest",
  heritage: "Historic",
  writerTrail: "Writer Trail",
  beerGarden: "Beer Garden",
  sports: "Live Sports",
  dateNight: "Date Night",
};

type ControlRailProps = {
  mode: CrawlMode;
  onModeChange: (mode: CrawlMode) => void;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  filteredVenues: Venue[];
  builtCount: number;
  onClearBuilt: () => void;
  onLoadCrawl: (crawl: CuratedCrawl) => void;
  onNearbyCrawl: () => void;
  nearbyLoading: boolean;
  nearbyError: string | null;
  // "Saved only": narrows the map + list to venues this device has saved. Owned by
  // PubMap; rendered here alongside the other story filters.
  savedOnly: boolean;
  onSavedOnlyChange: (savedOnly: boolean) => void;
  /** City curated crawls (from curatedCrawlsForCity). Defaults to London. */
  curatedCrawls?: CuratedCrawl[];
  /** City display name for headline + search placeholder. Defaults to London. */
  cityDisplayName?: string;
  /** City id — gates London-only writer card. Defaults to london. */
  cityId?: CityId;
};

export default function ControlRail({
  mode,
  onModeChange,
  filters,
  onFiltersChange,
  filteredVenues,
  builtCount,
  onClearBuilt,
  onLoadCrawl,
  onNearbyCrawl,
  nearbyLoading,
  nearbyError,
  savedOnly,
  onSavedOnlyChange,
  curatedCrawls = londonCuratedCrawls,
  cityDisplayName = "London",
  cityId = DEFAULT_CITY_ID,
}: ControlRailProps) {
  const searchPlaceholder = citySearchPlaceholder(cityId, cityDisplayName);
  const showWriterCard = cityId === "london";
  const cheapCount = filteredVenues.filter(
    (venue) => venue.cheapestPrice !== null && venue.cheapestPrice <= 5.5,
  ).length;
  const waterCount = filteredVenues.filter((venue) => venue.curation.nearWater).length;
  const heritageCount = filteredVenues.filter((venue) => venue.hasStory).length;
  const writerCount = filteredVenues.filter((venue) => venue.curation.writerPick).length;

  // Confirmed-so-far count for the honest accessibility summary: how many of the
  // CURRENTLY-SHOWN pubs are known to meet EVERY active accessibility filter.
  // Because filteredVenues has already been narrowed by those filters, this is
  // simply its length when any are on — but we recompute against the predicates
  // so the copy stays correct even if the caller ever passes an un-narrowed set.
  const accessibilityConfirmedCount = filteredVenues.filter(
    (venue) =>
      (!filters.requireStepFree || isKnownStepFree(venue)) &&
      (!filters.requireAccessibleToilet || isKnownAccessibleToilet(venue)) &&
      (!filters.requireSeatedService || isKnownSeatedService(venue)),
  ).length;
  const accessibilitySummary = accessibilityFilterSummary(
    {
      stepFree: filters.requireStepFree,
      accessibleToilet: filters.requireAccessibleToilet,
      seatedService: filters.requireSeatedService,
    },
    accessibilityConfirmedCount,
  );

  const filtersDirty = useMemo(
    () => JSON.stringify(filters) !== JSON.stringify(initialFilters),
    [filters],
  );
  function resetFilters() {
    onFiltersChange({ ...initialFilters, crawlStyle: filters.crawlStyle });
  }

  return (
    <aside className="controlRail">
      <div className="brandBlock">
        <div className="brandMark">
          <Beer size={22} />
        </div>
        <div>
          <p className="eyebrow">PUBMAXX</p>
          <h1>Design the right {cityDisplayName} pub crawl.</h1>
        </div>
      </div>

      <div className="modeToggle" role="group" aria-label="Crawl mode">
        <button
          className={mode === "suggest" ? "selected" : ""}
          aria-pressed={mode === "suggest"}
          onClick={() => onModeChange("suggest")}
        >
          <Sparkles size={15} /> Suggest a crawl
        </button>
        <button
          className={mode === "build" ? "selected" : ""}
          aria-pressed={mode === "build"}
          onClick={() => onModeChange("build")}
        >
          <Hand size={15} /> Build your own
        </button>
      </div>

      <button
        type="button"
        className="nearbyBtn"
        aria-label="Build a crawl from the pubs nearest to me"
        onClick={onNearbyCrawl}
        disabled={nearbyLoading}
      >
        <LocateFixed size={15} />
        {nearbyLoading ? "Finding your location…" : "Pubs near me"}
      </button>
      {nearbyError ? (
        <p className="nearbyError" role="alert">
          {nearbyError}
        </p>
      ) : null}

      {mode === "build" ? (
        <p className="buildHint">
          Tap pubs on the map or use the Add stops list in the route panel.{" "}
          {builtCount} stop{builtCount === 1 ? "" : "s"} picked.
          {builtCount > 0 ? (
            <button className="clearBtn" onClick={onClearBuilt}>
              <Trash2 size={13} /> Clear
            </button>
          ) : null}
        </p>
      ) : null}

      <label className="searchBox">
        <Search size={18} />
        <input
          id="railSearchInput"
          value={filters.query}
          onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          placeholder={searchPlaceholder}
        />
      </label>

      <section className="panelSection featuredRoutes">
        <div className="sectionTitle">
          <MapPinned size={16} />
          <span>Featured routes</span>
        </div>
        <p className="featuredHint">Hand-picked crawls. One generation&rsquo;s pubs, handed to the next.</p>
        <div className="featuredList">
          {curatedCrawls.map((crawl) => (
            <button
              key={crawl.id}
              className="featuredCrawl"
              data-crawl-style={crawl.crawlStyle}
              aria-label={`Map the ${crawl.name} crawl with ${crawl.venueIds.length} stops`}
              onClick={() => onLoadCrawl(crawl)}
            >
              <span className="featuredCrawlHead">
                <strong>{crawl.name}</strong>
                <span className="featuredCount">
                  {crawl.venueIds.length} stop{crawl.venueIds.length === 1 ? "" : "s"}
                </span>
              </span>
              <span className="featuredBlurb">{crawl.blurb}</span>
              <span className="featuredMapCta">
                <MapPinned size={13} aria-hidden="true" />
                Map route
              </span>
            </button>
          ))}
        </div>
      </section>

      {mode === "suggest" ? (
        <section className="panelSection">
          <div className="sectionTitle">
            <SlidersHorizontal size={16} />
            <span>Crawl Style</span>
          </div>
          <div className="segmented" role="group" aria-label="Crawl style">
            {(Object.keys(styleLabels) as CrawlStyle[]).map((style) => (
              <button
                key={style}
                className={filters.crawlStyle === style ? "selected" : ""}
                aria-pressed={filters.crawlStyle === style}
                onClick={() => onFiltersChange({ ...filters, crawlStyle: style })}
              >
                {styleLabels[style]}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panelSection">
        <div className="rangeLine">
          <span>Max Pint</span>
          {/* The slider's top end is the OFF value, so it reads as no cap
              rather than as a figure it never applies. */}
          <strong>
            {filters.maxPrice >= NO_PINT_PRICE_CAP ? "Any" : `£${filters.maxPrice.toFixed(2)}`}
          </strong>
        </div>
        <input
          type="range"
          min="4"
          max={NO_PINT_PRICE_CAP}
          step="0.25"
          value={filters.maxPrice}
          aria-label="Maximum pint price"
          onChange={(event) => onFiltersChange({ ...filters, maxPrice: Number(event.target.value) })}
        />
        {mode === "suggest" ? (
          <>
            <div className="rangeLine">
              <span>Stops</span>
              <strong>{filters.stopCount}</strong>
            </div>
            <input
              type="range"
              min="4"
              max="7"
              step="1"
              value={filters.stopCount}
              aria-label="Number of stops"
              onChange={(event) =>
                onFiltersChange({ ...filters, stopCount: Number(event.target.value) })
              }
            />
            <div className="rangeLine">
              <span>Max walk between stops</span>
              <strong>{filters.routeWindow} min</strong>
            </div>
            <input
              type="range"
              min="15"
              max="30"
              step="5"
              value={filters.routeWindow}
              aria-label="Route window in minutes"
              onChange={(event) =>
                onFiltersChange({ ...filters, routeWindow: Number(event.target.value) })
              }
            />
          </>
        ) : null}
      </section>

      <section className="panelSection toggles">
        <div className="sectionTitle">
          <Landmark size={16} />
          <span>Story Filters</span>
          {filtersDirty ? (
            <button className="resetBtn" style={{ marginLeft: "auto" }} onClick={resetFilters}>
              <Trash2 size={12} /> Reset
            </button>
          ) : null}
        </div>
        <label
          aria-label={SAVED_ONLY_ARIA_LABEL}
          style={{ minHeight: 44 }}
        >
          <input
            type="checkbox"
            checked={savedOnly}
            onChange={(event) => onSavedOnlyChange(event.target.checked)}
          />
          Saved only
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireWater}
            onChange={(event) => onFiltersChange({ ...filters, requireWater: event.target.checked })}
          />
          By the water
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireHeritage}
            onChange={(event) =>
              onFiltersChange({ ...filters, requireHeritage: event.target.checked })
            }
          />
          Heritage note
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requirePintDrops}
            onChange={(event) =>
              onFiltersChange({ ...filters, requirePintDrops: event.target.checked })
            }
          />
          Has Pint Drops
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireBeerGarden}
            onChange={(event) =>
              onFiltersChange({ ...filters, requireBeerGarden: event.target.checked })
            }
          />
          Beer garden
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireNonAlcoholic}
            onChange={(event) =>
              onFiltersChange({ ...filters, requireNonAlcoholic: event.target.checked })
            }
          />
          Non-alcoholic
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireLiveSports}
            onChange={(event) =>
              onFiltersChange({ ...filters, requireLiveSports: event.target.checked })
            }
          />
          Live sports
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireFood}
            onChange={(event) => onFiltersChange({ ...filters, requireFood: event.target.checked })}
          />
          Serves food
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireCocktails}
            onChange={(event) =>
              onFiltersChange({ ...filters, requireCocktails: event.target.checked })
            }
          />
          Cocktails
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.canonicalOnly}
            onChange={(event) =>
              onFiltersChange({ ...filters, canonicalOnly: event.target.checked })
            }
          />
          Verified listings only
        </label>
        <p className="accessibilityHint" style={{ marginTop: 4 }}>
          Off by default so scraped Young&apos;s / Nicholson&apos;s / guide pins stay on the map.
        </p>
        <label>
          <input
            type="checkbox"
            checked={filters.openNow}
            onChange={(event) =>
              onFiltersChange({ ...filters, openNow: event.target.checked })
            }
          />
          Open now
        </label>
        {filters.openNow ? (
          <p className="accessibilityHint" style={{ marginTop: 4 }} role="status">
            {OPEN_NOW_FILTER_CAPTION}
          </p>
        ) : null}
      </section>

      <section className="panelSection toggles accessibilityFilters">
        <div className="sectionTitle">
          <Accessibility size={16} />
          <span>Accessible venues</span>
        </div>
        <p className="accessibilityHint">
          Only pubs with access we can <strong>confirm</strong> from a public source. Unknown
          pubs are hidden here rather than guessed. Help by spilling what you know.
        </p>
        <label>
          <input
            type="checkbox"
            checked={filters.requireStepFree}
            onChange={(event) =>
              onFiltersChange({ ...filters, requireStepFree: event.target.checked })
            }
          />
          Step-free entry
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireAccessibleToilet}
            onChange={(event) =>
              onFiltersChange({ ...filters, requireAccessibleToilet: event.target.checked })
            }
          />
          Accessible toilet
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.requireSeatedService}
            onChange={(event) =>
              onFiltersChange({ ...filters, requireSeatedService: event.target.checked })
            }
          />
          Seated service
        </label>
        {accessibilitySummary ? (
          <p className="accessibilitySummary" role="status">
            {accessibilitySummary}
          </p>
        ) : null}
      </section>

      <section className="statsGrid">
        <div>
          <span>Matched</span>
          <strong>{filteredVenues.length}</strong>
        </div>
        <div>
          <span>≤ £5.50</span>
          <strong>{cheapCount}</strong>
        </div>
        <div>
          <span>Water</span>
          <strong>{waterCount}</strong>
        </div>
        <div>
          <span>Heritage</span>
          <strong>{heritageCount}</strong>
        </div>
        <div>
          <span>Writer</span>
          <strong>{writerCount}</strong>
        </div>
      </section>

      {filteredVenues.length === 0 ? (
        <section className="emptyState">
          <strong>Nothing fits that</strong>
          <p>You&rsquo;ve asked for something this patch hasn&rsquo;t got. Widen the pint price, or clear a story or amenity filter.</p>
          <button onClick={() => onFiltersChange(initialFilters)}>Reset filters</button>
        </section>
      ) : null}

      {showWriterCard ? (
        <section className="writerCard">
          <div className="writerHeader">
            <Camera size={18} />
            <div>
              <p className="eyebrow">{writerProfile.handle}</p>
              <h2>{writerProfile.name}</h2>
            </div>
          </div>
          <p>{writerProfile.summary}</p>
          <div className="writerFacts">
            <span>
              <BookOpen size={15} />
              {writerProfile.bookTitle}
            </span>
            <span>
              <Anchor size={15} />
              Narrowboat London
            </span>
          </div>
          <ul>
            {writerProfile.proofPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="sourceLinks">
            {pubSources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                {source.title}
                <ExternalLink size={13} />
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
