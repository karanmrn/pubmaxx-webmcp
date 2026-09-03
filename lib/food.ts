// Food menu model — parallel to lib/drinks.ts for the venue Menu tab.
// PURE + browser-safe. Every food fact carries provenance {source, licence,
// observedAt}; provenance NEVER flattens.

export const FOOD_CATEGORIES = [
  "breakfast",
  "starters",
  "sharers",
  "mains",
  "burgers",
  "short-eats",
  "bar-snacks",
  "sides",
  "desserts",
  "other",
] as const;

export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

export function isFoodCategory(value: unknown): value is FoodCategory {
  return typeof value === "string" && (FOOD_CATEGORIES as readonly string[]).includes(value);
}

export type FoodDietary = "vegan" | "vegetarian" | "gluten-free";

export type FoodProvenance = {
  source: string;
  licence: string;
  observedAt: string;
};

export type FoodItem = {
  id: string;
  name: string;
  category: FoodCategory;
  priceGbp: number;
  description?: string;
  dietary?: FoodDietary[];
  provenance: FoodProvenance;
  source?: string;
};

export type FoodCategoryMeta = {
  label: string;
  order: number;
};

export const FOOD_CATEGORY_META: Record<FoodCategory, FoodCategoryMeta> = {
  breakfast: { label: "Breakfast", order: 0 },
  starters: { label: "Starters", order: 1 },
  sharers: { label: "Sharers", order: 2 },
  mains: { label: "Mains", order: 3 },
  burgers: { label: "Burgers", order: 4 },
  "short-eats": { label: "Short eats", order: 5 },
  "bar-snacks": { label: "Bar snacks", order: 6 },
  sides: { label: "Sides", order: 7 },
  desserts: { label: "Desserts", order: 8 },
  other: { label: "Other", order: 9 },
};

export type FoodCategoryGroup = {
  category: FoodCategory;
  label: string;
  items: FoodItem[];
};

export function groupFoodByCategory(items: FoodItem[]): FoodCategoryGroup[] {
  const byCat = new Map<FoodCategory, FoodItem[]>();
  for (const item of items) {
    const list = byCat.get(item.category) ?? [];
    list.push(item);
    byCat.set(item.category, list);
  }
  return FOOD_CATEGORIES.filter((cat) => byCat.has(cat)).map((category) => ({
    category,
    label: FOOD_CATEGORY_META[category].label,
    items: byCat.get(category) ?? [],
  }));
}

/** Stable accent for food sections — warm brass-adjacent, distinct per family. */
export function foodCategoryColor(category: FoodCategory): string {
  const colors: Record<FoodCategory, string> = {
    breakfast: "#9a6a24",
    starters: "#8a5a2b",
    sharers: "#9a6a24",
    mains: "#6b4a2e",
    burgers: "#a0452c",
    desserts: "#8a2846",
    sides: "#5c5347",
    "short-eats": "#8a5a2b",
    "bar-snacks": "#7a5417",
    other: "#5c5347",
  };
  return colors[category];
}
