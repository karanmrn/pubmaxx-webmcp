"use client";

// Compact drink-shape filter chips for the map toolbar — continues the
// landing-page alcohol-shape metaphor without inventing pin categories.
// Tapping a glyph sets the same drinkCategory lens that /map?drink=… deep-links
// use (see lib/crawlUrl.ts). Do NOT also set filters.query — that AND'd with
// drinkCategory and dropped slim pins whose category isn't in name/searchText.
//
// PROGRESSIVE DISCLOSURE: the compact top strip never grows. The subtype row
// (white / dark / spiced rum…) and the top-shelf
// toggle appear only AFTER a category is picked, so a 390px phone shows one
// scrollable strip at rest and at most two once the user has committed to a
// family — the refinement can never crowd the resting toolbar.

// The chip styles live in mapToolbar.css, but this component also renders in
// the mobile filter sheet where MapToolbar (a desktop-only dynamic chunk) never
// mounts — so the stylesheet must ship with the component itself, or the mobile
// chips fall back to unstyled browser buttons with no selected state.
import "./mapToolbar.css";

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import {
  CATEGORY_META,
  type DrinkCategory,
  categoryLabel,
  isDrinkCategory,
} from "@/lib/drinks";
import {
  findSubtype,
  subtypesForCategory,
  type DrinkSubtype,
} from "@/lib/drinkSubtypes";
import type { Filters } from "@/lib/venues";

export const CHIP_CATEGORIES: DrinkCategory[] = [
  "beer",
  "wine",
  "cocktail",
  "whisky",
  "gin",
  "rum",
  "coffee",
  "alcohol-free",
  "soft-drink",
];

type DrinkShapeChipsProps = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
};

function activeCategory(filters: Filters): DrinkCategory | null {
  const lens = filters.drinkCategory.trim().toLowerCase();
  // Picker and deep links can select categories intentionally omitted from the
  // compact chip strip. They still own a refinement row.
  if (isDrinkCategory(lens)) return lens;
  return filters.requireCocktails ? "cocktail" : null;
}

/** The active subtype, but only while it still refines the active category. */
function activeSubtype(filters: Filters): DrinkSubtype | null {
  const subtype = findSubtype(filters.drinkSubtype);
  if (!subtype) return null;
  return subtype.category === activeCategory(filters) ? subtype : null;
}

export function nextDrinkShapeFilters(filters: Filters, cat: DrinkCategory): Filters {
  const active = activeCategory(filters);
  if (active === cat) {
    return {
      ...filters,
      requireCocktails: false,
      drinkCategory: "",
      drinkBrand: "",
      // Dropping the family drops its refinement — an orphaned subtype would
      // keep silently narrowing a lens the user just switched off.
      drinkSubtype: "",
      // Top shelf is disclosed inside the family refinement row. Clearing the
      // family must clear it too, or an active filter becomes impossible to
      // switch off from the now-hidden row.
      topShelfOnly: false,
    };
  }
  return {
    ...filters,
    requireCocktails: cat === "cocktail",
    drinkCategory: cat,
    drinkBrand: "",
    drinkSubtype: "",
  };
}

/** Toggle a subtype refinement. The parent category is set alongside it, never replaced. */
export function nextDrinkSubtypeFilters(
  filters: Filters,
  subtypeId: string,
): Filters {
  const subtype = findSubtype(subtypeId);
  if (!subtype) return filters;
  const on = activeSubtype(filters)?.id === subtype.id;
  return {
    ...filters,
    drinkCategory: subtype.category,
    requireCocktails: subtype.category === "cocktail",
    drinkSubtype: on ? "" : subtype.id,
  };
}

export function nextTopShelfFilters(filters: Filters): Filters {
  // Control is progressively disclosed beneath a category. Refuse orphaned
  // state so no active filter can become inaccessible after that row unmounts.
  const active = activeCategory(filters);
  if (!active) return filters;
  // Pin the category alongside the flag (mirroring nextDrinkSubtypeFilters):
  // when the row was disclosed by requireCocktails alone, clearing that
  // checkbox must not strand topShelfOnly behind an unmounted row, and the
  // URL/session codecs only carry topshelf together with a category.
  return {
    ...filters,
    drinkCategory: active,
    topShelfOnly: !filters.topShelfOnly,
  };
}

/**
 * Category community prices do not carry subtype or top-shelf evidence.
 * Keep those refinements off non-pint price lenses so controls cannot imply
 * that a bare category price proves a more specific drink.
 */
export function showsDrinkRefinements(filters: Filters): boolean {
  return activeCategory(filters) === "beer";
}

export default function DrinkShapeChips({
  filters,
  onFiltersChange,
}: DrinkShapeChipsProps) {
  const active = activeCategory(filters);
  const subtype = activeSubtype(filters);
  const subtypes = active ? subtypesForCategory(active) : [];

  return (
    <div className="drinkShapeChipsStack">
      <div className="drinkShapeChips" role="group" aria-label="Filter by drink shape">
        {CHIP_CATEGORIES.map((cat) => {
          const on = active === cat;
          return (
            <button
              key={cat}
              type="button"
              className={on ? "drinkShapeChip isOn" : "drinkShapeChip"}
              aria-pressed={on}
              aria-label={`${CATEGORY_META[cat].label}${on ? " (selected)" : ""}`}
              onClick={() => onFiltersChange(nextDrinkShapeFilters(filters, cat))}
            >
              {/* The glyph keeps its own drink colour in BOTH states now that
                  selection is a neutral fill, not a coral one. Inheriting the
                  label colour on selection dropped the chosen drink to
                  monochrome while the unchosen ones stayed in colour,
                  which read backwards. */}
              <DrinkGlyph category={cat} size={22} />
              <span className="drinkShapeChipLabel">{categoryLabel(cat)}</span>
            </button>
          );
        })}
      </div>

      {active && showsDrinkRefinements(filters) ? (
        <div
          className="drinkSubtypeChips"
          role="group"
          aria-label={`Refine ${CATEGORY_META[active].label}`}
        >
          {subtypes.map((option) => {
            const on = subtype?.id === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={on ? "drinkSubtypeChip isOn" : "drinkSubtypeChip"}
                aria-pressed={on}
                aria-label={`${option.longLabel}${on ? " (selected)" : ""}`}
                onClick={() =>
                  onFiltersChange(nextDrinkSubtypeFilters(filters, option.id))
                }
              >
                {option.label}
              </button>
            );
          })}
          <button
            type="button"
            className={
              filters.topShelfOnly
                ? "drinkSubtypeChip isTopShelf isOn"
                : "drinkSubtypeChip isTopShelf"
            }
            aria-pressed={filters.topShelfOnly}
            aria-label={`Top shelf only${filters.topShelfOnly ? " (selected)" : ""}`}
            onClick={() => onFiltersChange(nextTopShelfFilters(filters))}
          >
            Top shelf
          </button>
        </div>
      ) : null}
    </div>
  );
}
