import type { CommunityPrice } from "@/lib/communityPrice";
import { SUBMITTABLE_DRINK_CATEGORIES } from "@/lib/communityPrice";
import {
  CATEGORY_META,
  MAP_LENS_DRINK_CATEGORIES,
  type DrinkCategory,
} from "@/lib/drinks";
import {
  drinkLensPriceNoun,
  type CategoryPriceIndexStatus,
  type MapExperienceLens,
} from "@/lib/mapExperienceLens";
import type { Filters } from "@/lib/venues";

// A drink LANE is one drink the map can be put under, and this module owns the
// whole of what that means: which drinks qualify, what each is called on a
// control, the single filter write that switches lane, how a pub's own prices
// are ordered under one, and the one sentence an empty lane may say.
//
// It exists because the lane used to live in three places that could drift: a
// `<select>` inside the pint-brand picker, an inline filter updater copied at
// three call sites, and per-surface copy. One table, one write, one voice.
//
// PURE and browser-safe. The trust gates stay where they were: which figures a
// lane may paint is still `trustedDrinkLensPrices`, and nothing here widens
// them. Lanes carry prices; they never carry authority.

/** The map's own word for one lane, plus the noun a sentence uses. */
export type DrinkLane = {
  category: DrinkCategory;
  /** Control label. Beer is "Pints" on a map, not "Beer". */
  label: string;
  /** The drink inside a sentence: "no cocktail price logged". */
  noun: string;
  /** The lane the map rests in. Selecting it clears the drink lens. */
  isDefault: boolean;
};

/**
 * Beer is the lane the map rests in, so it is never a "selected drink lens":
 * `filters.drinkCategory` stays empty for it, and the pint bands, the pint
 * label and the cheapest-pint buckets stay exactly as they were.
 */
export const DEFAULT_DRINK_LANE: DrinkCategory = "beer";

export type VenueDrinkPriceView = {
  rows: readonly CommunityPrice[] | undefined;
  lane: DrinkCategory;
};

export function venueDrinkPriceView(
  rows: readonly CommunityPrice[] | undefined,
  experienceLens: MapExperienceLens,
  drinkLensCategory: DrinkCategory | null | undefined,
): VenueDrinkPriceView {
  if (experienceLens === "food") {
    return { rows: undefined, lane: DEFAULT_DRINK_LANE };
  }
  if (experienceLens === "no-alcohol") {
    return {
      rows: rows?.filter(
        (row) =>
          row.drinkCategory === "soft-drink" ||
          row.drinkCategory === "alcohol-free",
      ),
      lane: "alcohol-free",
    };
  }
  return {
    rows,
    lane: drinkLensCategory ?? DEFAULT_DRINK_LANE,
  };
}

/** The map's word for the resting lane. The taxonomy still calls it "Beer". */
export const DEFAULT_DRINK_LANE_LABEL = "Pints";

/**
 * Every lane a viewer may put the map under, in menu order. Derived from
 * MAP_LENS_DRINK_CATEGORIES so a category the map cannot label or clear (today
 * `other`) can never appear here, and from CATEGORY_META.order so the picker,
 * the sheet and the submit chips read in one sequence.
 */
export const MAP_DRINK_LANES: readonly DrinkLane[] = [
  ...MAP_LENS_DRINK_CATEGORIES,
]
  .sort((left, right) => CATEGORY_META[left].order - CATEGORY_META[right].order)
  .map((category) => ({
    category,
    label:
      category === DEFAULT_DRINK_LANE
        ? DEFAULT_DRINK_LANE_LABEL
        : CATEGORY_META[category].label,
    noun: drinkLensPriceNoun(category),
    isDefault: category === DEFAULT_DRINK_LANE,
  }));

/** The lane a filter state is in. Null is impossible: an empty filter is beer. */
export function activeDrinkLane(drinkCategory: string): DrinkCategory {
  const lane = MAP_DRINK_LANES.find(
    (candidate) => candidate.category === drinkCategory,
  );
  return lane ? lane.category : DEFAULT_DRINK_LANE;
}

export function drinkLaneLabel(category: DrinkCategory): string {
  return (
    MAP_DRINK_LANES.find((lane) => lane.category === category)?.label ??
    CATEGORY_META[category].label
  );
}

export function drinkLaneNoun(category: DrinkCategory): string {
  return (
    MAP_DRINK_LANES.find((lane) => lane.category === category)?.noun ??
    drinkLensPriceNoun(category)
  );
}

/**
 * Switching lane is ONE write, so no call site can invent its own half of it.
 *
 * A lane is a drink, not a brand or a shape, so the refinements that only make
 * sense inside the lane you left (a pint brand, a subtype, top shelf) go with
 * it. Re-picking the lane you are already in changes nothing, so a reader who
 * taps "Pints" twice does not lose the pint they chose.
 */
export function applyDrinkLane(filters: Filters, next: DrinkCategory): Filters {
  if (activeDrinkLane(filters.drinkCategory) === next) return filters;
  const isDefault = next === DEFAULT_DRINK_LANE;
  return {
    ...filters,
    drinkCategory: isDefault ? "" : next,
    drinkBrand: "",
    drinkSubtype: "",
    topShelfOnly: false,
    requireCocktails: next === "cocktail",
  };
}

/** One pub's freshest community price for one drink, with its own tag. */
export type VenueDrinkPriceRow = {
  category: DrinkCategory;
  /** The drink tag the row prints. Always this row's own category. */
  label: string;
  price: CommunityPrice;
  /** This row answers the lane the map is under. */
  inActiveLane: boolean;
};

/**
 * A pub's community prices as one row per drink, the viewer's lane first.
 *
 * Ordering is the only thing that reads the lane: a row's figure, its tag and
 * its date are always its own category's, so no ordering can make a wine price
 * answer a cocktail question. Two rows of one category collapse to the freshest
 * rather than printing twice, because a category has one current answer.
 */
export function orderVenueDrinkPrices(
  rows: readonly CommunityPrice[] | undefined,
  activeLane: DrinkCategory,
): VenueDrinkPriceRow[] {
  if (!rows || rows.length === 0) return [];
  const freshest = new Map<DrinkCategory, CommunityPrice>();
  for (const row of rows) {
    const held = freshest.get(row.drinkCategory);
    if (!held || row.submittedAt > held.submittedAt) {
      freshest.set(row.drinkCategory, row);
    }
  }
  return [...freshest.values()]
    .map((price) => ({
      category: price.drinkCategory,
      label: CATEGORY_META[price.drinkCategory].label,
      price,
      inActiveLane: price.drinkCategory === activeLane,
    }))
    .sort((left, right) => {
      if (left.inActiveLane !== right.inActiveLane) {
        return left.inActiveLane ? -1 : 1;
      }
      return (
        CATEGORY_META[left.category].order - CATEGORY_META[right.category].order
      );
    });
}

/**
 * The submit chips for a viewer under one lane: the standard shortcut list,
 * plus the lane itself when it is not already on it.
 *
 * Every lane is loggable (the server takes any DrinkCategory), but the chip
 * list is a shortcut, not an allowlist, so a gin lane used to open the composer
 * on beer with no gin chip in sight. The lane joins right after beer, where the
 * eye already is, and never displaces a category that was there.
 */
export function submitCategoriesForLane(
  lane: DrinkCategory,
): readonly DrinkCategory[] {
  if (SUBMITTABLE_DRINK_CATEGORIES.includes(lane)) {
    return SUBMITTABLE_DRINK_CATEGORIES;
  }
  const rest = SUBMITTABLE_DRINK_CATEGORIES.filter(
    (category) => category !== DEFAULT_DRINK_LANE,
  );
  return [DEFAULT_DRINK_LANE, lane, ...rest];
}

/**
 * The one line an empty lane may add, and only once a read has ANSWERED.
 *
 * A read still running or one that failed is not evidence that nobody has
 * logged this drink, and asking for a contribution on the strength of our own
 * failure would be the same overclaim the empty-state helpers exist to stop.
 * The sentence that states the emptiness is `drinkLensEmptyVenueNote` and its
 * row-level siblings; this only adds the invitation after one of them.
 */
export function drinkLaneLogInvite(
  noun: string,
  status: CategoryPriceIndexStatus,
): string | null {
  if (status !== "ready" && status !== "partial") return null;
  return `Log a ${noun} price when you are at the bar. It shows on that pub's page straight away.`;
}

/** The action on that invitation, named for the drink it logs. */
export function drinkLaneLogActionLabel(noun: string): string {
  return `Log a ${noun} price`;
}
