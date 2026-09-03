// DrinkGlyph — the single entry point for drink-category imagery (Epic E5).
// ---------------------------------------------------------------------------
// Dispatches to the right ORIGINAL SVG glyph (our IP, licence-safe) for a
// category and colours it from the theme-aware category token
// (`var(--cat-*)`), so it renders correctly in light, dark AND Legacy Mode
// with zero per-call theming. Crisp at any size (16 → 128px) — all glyphs share
// a 32×32 viewBox and stroke with currentColor.
//
// Usage:
//   import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
//   <DrinkGlyph category="wine" size={40} title="Wine" />   // labelled
//   <DrinkGlyph category="gin" />                            // decorative
//
// E1's DrinkMenu can import this directly for its per-category section icons.
import type { CSSProperties, ReactElement } from "react";
import type { DrinkCategory } from "@/lib/drinks";
import { categoryColor } from "@/lib/categoryColors";
import {
  BeerGlyph,
  WineGlyph,
  WhiskyGlyph,
  GinGlyph,
  RumGlyph,
  VodkaGlyph,
  CocktailGlyph,
  ShotGlyph,
  AlcoholFreeGlyph,
  SoftDrinkGlyph,
  CoffeeGlyph,
  OtherGlyph,
  type GlyphProps,
} from "./icons";

const GLYPHS: Record<DrinkCategory, (p: GlyphProps) => ReactElement> = {
  beer: BeerGlyph,
  wine: WineGlyph,
  whisky: WhiskyGlyph,
  gin: GinGlyph,
  rum: RumGlyph,
  vodka: VodkaGlyph,
  cocktail: CocktailGlyph,
  shot: ShotGlyph,
  "alcohol-free": AlcoholFreeGlyph,
  "soft-drink": SoftDrinkGlyph,
  coffee: CoffeeGlyph,
  other: OtherGlyph,
};

export interface DrinkGlyphProps extends GlyphProps {
  category: DrinkCategory;
  /**
   * When true, do NOT apply the category colour — inherit `currentColor` from
   * the parent instead (e.g. a mono chip). Defaults to false (category-coloured).
   */
  inheritColor?: boolean;
}

export function DrinkGlyph({
  category,
  size = 32,
  inheritColor = false,
  style,
  ...rest
}: DrinkGlyphProps) {
  const Glyph = GLYPHS[category] ?? OtherGlyph;
  // `color` sets currentColor for the stroke/fill; the token flips with theme.
  const mergedStyle: CSSProperties = inheritColor
    ? (style ?? {})
    : { color: categoryColor(category), ...style };
  return <Glyph size={size} style={mergedStyle} {...rest} />;
}

export { GLYPHS as DRINK_GLYPHS };
