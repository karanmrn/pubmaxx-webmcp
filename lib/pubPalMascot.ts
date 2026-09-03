import {
  PAL_MASCOT_SIZES,
  palMascotSlug,
  type PalMascotSlug,
} from "@/lib/palMascotAssets.mjs";
import type { PubPalSpecies } from "@/lib/pubPal";

export const PUB_PAL_MASCOT_ALT = "Pub Pal";

export const PUB_PAL_MASCOT_SIZES = PAL_MASCOT_SIZES;

export type PubPalMascotSize = (typeof PUB_PAL_MASCOT_SIZES)[number];

export type PubPalMascotKind = "square" | "avatar";

/** Circuit Robin is the assistant face, so a caller that names no species gets it. */
export const DEFAULT_MASCOT_SPECIES: PubPalSpecies = "robin";

/**
 * The slug for a species that ships a master, or null when it has none and the
 * surface owes it a layered-SVG rig instead. This is the ONE question a surface
 * asks: nothing may compare a species name to decide which artwork to draw.
 */
export function pubPalMascotSlugFor(species: PubPalSpecies): PalMascotSlug | null {
  return palMascotSlug(species);
}

export function pubPalMascotSrc(
  slug: PalMascotSlug,
  kind: PubPalMascotKind,
  size: PubPalMascotSize,
  ext: "webp" | "png",
): string {
  if (kind === "avatar") return `/pal/${slug}-avatar-${size}.${ext}`;
  return `/pal/${slug}-${size}.${ext}`;
}

export function pubPalMascotSrcSet(
  slug: PalMascotSlug,
  kind: PubPalMascotKind,
  ext: "webp" | "png",
): string {
  return PUB_PAL_MASCOT_SIZES.map((size) => `${pubPalMascotSrc(slug, kind, size, ext)} ${size}w`).join(", ");
}

export function pubPalMascotFallbackSize(px: number): PubPalMascotSize {
  return PUB_PAL_MASCOT_SIZES.find((size) => size >= px) ?? 512;
}
