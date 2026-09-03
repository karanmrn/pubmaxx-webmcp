// Shared props for every drink glyph. All glyphs are ORIGINAL SVG line-art
// (our IP — see components/drinks/README note + DESIGN_SYSTEM.md licence note).
// They draw with `currentColor` so the caller sets the category colour via the
// `color` CSS property (DrinkGlyph wires that to `var(--cat-*)`), and inherit
// crisp rendering at any size from a shared 32×32 viewBox.
import type { SVGProps } from "react";

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Pixel size (square). Defaults to 32. */
  size?: number;
  /** Accessible title; when omitted the glyph is aria-hidden decoration. */
  title?: string;
}

// Common wiring: square box, currentColor stroke, non-scaling nothing fancy —
// just clean geometry that stays crisp at 16px and 128px.
export function baseSvgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    xmlns: "http://www.w3.org/2000/svg",
  };
}
