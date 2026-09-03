import type { CategoryPriceIndexStatus } from "@/lib/mapExperienceLens";
import type {
  MapRenderedPriceBand,
  MapRenderedPriceBucket,
  MapRenderedPriceMeaning,
  MapRenderedState,
} from "@/lib/mapRenderedState";

export type MapPriceLegendRow = {
  label: string;
  symbol: "£" | "££" | "£££" | "?";
  tone: "green" | "amber" | "red" | "grey";
};

export type MapKeyEntry = {
  id: string;
  label: string;
  detail: string;
  colour?: string;
};

export type MapPriceLegendModel = {
  rows: MapPriceLegendRow[];
  ariaLabel: string;
  title: string;
  hint: string;
  clusterNote: string | null;
  shapes: MapKeyEntry[];
  marks: MapKeyEntry[];
  routeMarks: MapKeyEntry[];
  noAlcoholNote: string | null;
};

type MapPriceLegendMapState = {
  renderedState: MapRenderedState;
};

export type MapPriceLegendContext = (
  | {
      kind: "default";
    }
  | {
      kind: "drink";
      label: string;
      noun: string;
      status: CategoryPriceIndexStatus;
    }
  | {
      kind: "food";
    }
) &
  MapPriceLegendMapState;

const PRICE_CLUSTER_NOTE =
  "A split cluster ring shows the mix of price bands inside it. A solid cluster uses the most common known price band. Grey means none has a known map price. The number is every venue in the cluster.";

const FOOD_CLUSTER_NOTE =
  "Food clusters stay grey because food prices do not colour this map. The number is every venue in the cluster.";

const MAP_SHAPES: MapKeyEntry[] = [
  {
    id: "pub-drink",
    label: "Pint, wine, cocktail or spirit glass",
    detail: "Pub. The glass follows its recorded drinks or the drink view you chose.",
  },
  { id: "bar", label: "Coupe glass", detail: "Bar." },
  { id: "late-food", label: "Skewer", detail: "Late food." },
  { id: "restaurant", label: "Fork", detail: "Restaurant." },
  {
    id: "base-pub",
    label: "Hollow circle and dot",
    detail: "Pub on the UK base map. No map price.",
  },
  {
    id: "landmark",
    label: "Brass pictogram",
    detail: "Landmark, not a pub.",
  },
];

const MAP_MARKS: MapKeyEntry[] = [
  {
    id: "your-location",
    label: "Blue centre with a pulse",
    detail: "Your approximate location.",
  },
  {
    id: "tonight-opportunity",
    label: "Amber point with a blue halo",
    detail: "Place in the Events overlay for tonight.",
  },
  {
    id: "pint-drop",
    label: "Blue ring",
    detail: "This pub has a visible Pint Drop.",
  },
  { id: "quiz", label: "Amber ring", detail: "Quiz on tonight." },
  { id: "sport", label: "Bright blue ring", detail: "Live sport shown here." },
  { id: "deal", label: "Bright brass ring", detail: "Deal on tonight." },
  { id: "music", label: "Dark blue ring", detail: "Live music tonight." },
  {
    id: "public-listing",
    label: "Thin brass ring",
    detail: "Pub added from a public listing.",
  },
  {
    id: "base-selected",
    label: "Single brass selection ring",
    detail: "UK base pub you selected.",
  },
  {
    id: "selected",
    label: "Double brass ring",
    detail: "Pub you selected.",
  },
];

const ROUTE_MARKS: MapKeyEntry[] = [
  {
    id: "crawl-stop",
    label: "Numbered dark circle",
    detail: "Stop in your crawl.",
  },
  {
    id: "walking-route",
    label: "Solid line",
    detail: "Walking route along roads.",
    colour: "var(--route-line)",
  },
  {
    id: "straight-route",
    label: "Dashed line",
    detail: "Straight estimate while a road route is unavailable.",
    colour: "var(--route-line)",
  },
];

const NO_ALCOHOL_NOTE =
  "The no-alcohol view has no separate pin shape. It uses alcohol-free and soft drink prices. Missing prices stay grey.";

function priceRows(noun: string): MapPriceLegendRow[] {
  return [
    { label: "£5.50 or less", symbol: "£", tone: "green" },
    { label: "Over £5.50, up to £7", symbol: "££", tone: "amber" },
    { label: "Over £7", symbol: "£££", tone: "red" },
    {
      label: `No ${noun} price on the map`,
      symbol: "?",
      tone: "grey",
    },
  ];
}

/**
 * The four band-colour rows the first-map orientation beat teaches.
 * Reuses the default pint vocabulary so the tour, MapKey, and the Layers
 * price cap never invent separate labels for the same colours.
 */
export function orientationLegendRows(): readonly MapPriceLegendRow[] {
  return priceRows("pint");
}

/** Title shown on the one-shot first-map orientation beat. */
export const ORIENTATION_LEGEND_TITLE = "Pint price colours";

function renderedRows(
  rows: MapPriceLegendRow[],
  bands: readonly MapRenderedPriceBand[],
  meaning?: MapRenderedPriceMeaning,
): MapPriceLegendRow[] {
  const renderedBuckets = new Set(
    bands
      .filter((band) => meaning === undefined || band.meaning === meaning)
      .map((band) => band.bucket),
  );
  return rows.filter((_, bucket) =>
    renderedBuckets.has(bucket as MapRenderedPriceBucket),
  );
}

function mixedPriceRows(): MapPriceLegendRow[] {
  return [
    {
      label: "£5.50 or less; low for its venue type",
      symbol: "£",
      tone: "green",
    },
    {
      label: "Over £5.50, up to £7; middle for its venue type",
      symbol: "££",
      tone: "amber",
    },
    {
      label: "Over £7; high for its venue type",
      symbol: "£££",
      tone: "red",
    },
    {
      label: "No pint or venue price on the map",
      symbol: "?",
      tone: "grey",
    },
  ];
}

function typeRelativePriceRows(): MapPriceLegendRow[] {
  return [
    {
      label: "Low for its venue type",
      symbol: "£",
      tone: "green",
    },
    {
      label: "Middle for its venue type",
      symbol: "££",
      tone: "amber",
    },
    {
      label: "High for its venue type",
      symbol: "£££",
      tone: "red",
    },
    {
      label: "No venue price on the map",
      symbol: "?",
      tone: "grey",
    },
  ];
}

function mixedRenderedRows(
  bands: readonly MapRenderedPriceBand[],
): MapPriceLegendRow[] {
  const pintRows = priceRows("pint");
  const typeRelativeRows = typeRelativePriceRows();
  const mixedRows = mixedPriceRows();
  const pairs = new Set(
    bands.map((band) => `${band.meaning}:${band.bucket}`),
  );

  return ([0, 1, 2, 3] as const).flatMap((bucket) => {
    const hasPintMeaning = pairs.has(`pint:${bucket}`);
    const hasTypeRelativeMeaning = pairs.has(`type-relative:${bucket}`);
    if (hasPintMeaning && hasTypeRelativeMeaning) {
      return [mixedRows[bucket]];
    }
    if (hasPintMeaning) return [pintRows[bucket]];
    if (hasTypeRelativeMeaning) return [typeRelativeRows[bucket]];
    return [];
  });
}

function renderedBuckets(
  bands: readonly MapRenderedPriceBand[],
): MapRenderedPriceBucket[] {
  return Array.from(new Set(bands.map((band) => band.bucket))).sort(
    (left, right) => left - right,
  );
}

type MapKeyDeclarations = Pick<
  MapPriceLegendModel,
  "clusterNote" | "shapes" | "marks" | "routeMarks" | "noAlcoholNote"
>;

function declaredLegend(
  legend: Pick<MapPriceLegendModel, "rows" | "ariaLabel" | "title" | "hint">,
  declarations: Partial<MapKeyDeclarations>,
): MapPriceLegendModel {
  return {
    ...legend,
    clusterNote: null,
    shapes: [],
    marks: [],
    routeMarks: [],
    noAlcoholNote: null,
    ...declarations,
  };
}

function mapMarks(
  provisionalDetail: string,
  storyColour: string | null,
): MapKeyEntry[] {
  return [
    MAP_MARKS[0],
    {
      id: "provisional",
      label: "Small blue dot beside a pin",
      detail: provisionalDetail,
    },
    ...MAP_MARKS.slice(1),
    ...(storyColour
      ? [
          {
            id: "story-band",
            label: "Coloured ring",
            detail: "Pub in the place story you chose.",
            colour: storyColour,
          },
        ]
      : []),
  ];
}

function routeMarks(storyColour: string | null): MapKeyEntry[] {
  return [
    ...ROUTE_MARKS,
    ...(storyColour
      ? [
          {
            id: "story-corridor",
            label: "Broad translucent line",
            detail:
              "Corridor joining the landmarks in the place story you chose.",
            colour: storyColour,
          },
        ]
      : []),
  ];
}

/**
 * The key's hint is the map's own claim about how complete its colours are, so
 * it reports the index's three states apart: a partial read still painted real
 * figures and keeps the "trusted prices" sentence, while a failed read says so
 * rather than letting an all-unknown map read as a city with no prices in it.
 */
function drinkHint(
  drink: string,
  status: CategoryPriceIndexStatus,
  hasKnownBand: boolean,
): string {
  if (status === "idle" || status === "loading") {
    if (hasKnownBand) {
      return `Checking for more ${drink} prices. Pin colours show trusted prices already loaded; pubs without one stay unknown.`;
    }
    return `Checking ${drink} prices. Pubs without a trusted one stay unknown.`;
  }
  if (status === "degraded") {
    if (hasKnownBand) {
      return `We could not refresh the ${drink} prices just now. Pin colours still show trusted prices already loaded; pubs without one stay unknown.`;
    }
    return `We could not read the ${drink} prices just now, so no pub is coloured by one yet.`;
  }
  if (status === "partial") {
    return `Pin colours follow trusted ${drink} prices, read from part of the list. Pubs without one stay unknown.`;
  }
  return `Pin colours follow trusted ${drink} prices. Pubs without one stay unknown.`;
}

function drinkClusterNote(
  drink: string,
  status: CategoryPriceIndexStatus,
  buckets: readonly MapRenderedPriceBucket[],
): string | null {
  if (buckets.length === 0) return null;
  if (buckets.some((bucket) => bucket !== 3)) return PRICE_CLUSTER_NOTE;
  if (status === "degraded") {
    return `Clusters stay grey because ${drink} prices could not be read just now. The number is every venue in the cluster.`;
  }
  return `Clusters stay grey because no current venue has a trusted ${drink} price. The number is every venue in the cluster.`;
}

function defaultClusterNote(
  buckets: readonly MapRenderedPriceBucket[],
): string | null {
  if (buckets.length === 0) return null;
  if (buckets.some((bucket) => bucket !== 3)) return PRICE_CLUSTER_NOTE;
  return "Clusters stay grey because no current venue has a known map price. The number is every venue in the cluster.";
}

export function mapPriceLegend(
  context: MapPriceLegendContext,
): MapPriceLegendModel {
  const { priceBands, storyColour } = context.renderedState;
  const priceBuckets = renderedBuckets(priceBands);
  if (context.kind === "food") {
    return declaredLegend(
      {
        rows: priceBuckets.includes(3)
          ? [
              {
                label: "Food pins and clusters stay grey",
                symbol: "?" as const,
                tone: "grey" as const,
              },
            ]
          : [],
        ariaLabel: "Food map key: pins and clusters do not show prices",
        title: "Food view",
        hint:
          "Pins and clusters stay grey. Any sourced menu prices stay on venue cards and sheets.",
      },
      {
        clusterNote:
          priceBuckets.length === 0 ? null : FOOD_CLUSTER_NOTE,
        shapes: MAP_SHAPES,
        marks: mapMarks(
          "A recent pint report. It doesn't set a food pin's colour. A UK base pub keeps only the dot.",
          storyColour,
        ),
        routeMarks: routeMarks(storyColour),
        noAlcoholNote: null,
      },
    );
  }
  if (context.kind === "drink") {
    const drink = context.noun.toLowerCase();
    const hasKnownBand = priceBuckets.some((bucket) => bucket !== 3);
    const unreadable =
      context.status === "degraded" && !hasKnownBand;
    const rows = renderedRows(priceRows(drink), priceBands);
    return declaredLegend(
      {
        rows: unreadable ? rows.slice(-1) : rows,
        ariaLabel: unreadable
          ? `${context.label} price colour key, unavailable`
          : `${context.label} price colour key`,
        title: unreadable
          ? `${context.label} prices unavailable`
          : `${context.label} price bands`,
        hint: drinkHint(drink, context.status, hasKnownBand),
      },
      {
        clusterNote: drinkClusterNote(
          drink,
          context.status,
          priceBuckets,
        ),
        shapes: MAP_SHAPES,
        marks: mapMarks(
          "A recent pint report. It doesn't set the selected drink band. A UK base pub keeps only the dot.",
          storyColour,
        ),
        routeMarks: routeMarks(storyColour),
        noAlcoholNote:
          context.label === "No-alcohol" ? NO_ALCOHOL_NOTE : null,
      },
    );
  }
  const hasPintPrices = priceBands.some(
    (band) => band.meaning === "pint",
  );
  const usesTypeRelativeMeaning = priceBands.some(
    (band) => band.meaning === "type-relative",
  );
  if (hasPintPrices && !usesTypeRelativeMeaning) {
    return declaredLegend(
      {
        rows: renderedRows(priceRows("pint"), priceBands, "pint"),
        ariaLabel: "Pint price key and filters",
        title: "Pint price key and filters",
        hint: "Show pubs at or under this pint price.",
      },
      {
        clusterNote: defaultClusterNote(priceBuckets),
        shapes: MAP_SHAPES,
        marks: mapMarks(
          "A recent pint report. On a listed pub in the standard pint view, a second independent drinker reporting a similar price can set the pin's band. A UK base pub keeps only the dot.",
          storyColour,
        ),
        routeMarks: routeMarks(storyColour),
        noAlcoholNote: NO_ALCOHOL_NOTE,
      },
    );
  }
  if (usesTypeRelativeMeaning && !hasPintPrices) {
    return declaredLegend(
      {
        rows: renderedRows(
          typeRelativePriceRows(),
          priceBands,
          "type-relative",
        ),
        ariaLabel: "Venue type price colour key",
        title: "Venue price bands",
        hint: "Each venue pin is low, middle, or high within its own type.",
      },
      {
        clusterNote: defaultClusterNote(priceBuckets),
        shapes: MAP_SHAPES,
        marks: mapMarks(
          "A recent pint report. It doesn't set a non-pub venue's band. A UK base pub keeps only the dot.",
          storyColour,
        ),
        routeMarks: routeMarks(storyColour),
        noAlcoholNote: NO_ALCOHOL_NOTE,
      },
    );
  }
  if (!hasPintPrices && !usesTypeRelativeMeaning) {
    return declaredLegend(
      {
        rows: [],
        ariaLabel: "Map price colour key",
        title: "Map price key",
        hint: "No venue price colours are currently drawn.",
      },
      {
        clusterNote: null,
        shapes: MAP_SHAPES,
        marks: mapMarks(
          "A recent pint report. A UK base pub keeps only the dot.",
          storyColour,
        ),
        routeMarks: routeMarks(storyColour),
        noAlcoholNote: NO_ALCOHOL_NOTE,
      },
    );
  }
  return declaredLegend(
    {
      rows: mixedRenderedRows(priceBands),
      ariaLabel:
        "Price colour key: pub pints use pound thresholds; other venue types use relative low, middle, and high bands",
      title: "Pint prices and other venue price bands",
      hint:
        "Pub pins use pint thresholds. Each other venue pin is low, middle, or high within its own type.",
    },
    {
      clusterNote: defaultClusterNote(priceBuckets),
      shapes: MAP_SHAPES,
      marks: mapMarks(
        "A recent pint report. On a listed pub in the standard pint view, a second independent drinker reporting a similar price can set the pin's band. A UK base pub keeps only the dot.",
        storyColour,
      ),
      routeMarks: routeMarks(storyColour),
      noAlcoholNote: NO_ALCOHOL_NOTE,
    },
  );
}
