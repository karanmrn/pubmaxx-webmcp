import type { PubPalSpecies } from "@/lib/pubPal";
import {
  DEFAULT_MASCOT_SPECIES,
  PUB_PAL_MASCOT_ALT,
  pubPalMascotFallbackSize,
  pubPalMascotSlugFor,
  pubPalMascotSrc,
  pubPalMascotSrcSet,
  type PubPalMascotKind,
} from "@/lib/pubPalMascot";

export function PubPalMascot({
  species = DEFAULT_MASCOT_SPECIES,
  size = 32,
  circular = true,
  lazy = false,
  decorative = false,
  className,
}: {
  /** Defaults to Circuit Robin, the assistant face. */
  species?: PubPalSpecies;
  size?: number;
  circular?: boolean;
  lazy?: boolean;
  /** When true, the image is hidden from assistive tech because a parent names the portrait. */
  decorative?: boolean;
  className?: string;
}) {
  const slug = pubPalMascotSlugFor(species);
  // A species with no master has no renditions to point at, so drawing one would
  // ask for four files that do not exist. The caller owes it a rig instead.
  if (!slug) return null;
  const kind: PubPalMascotKind = circular ? "avatar" : "square";
  return (
    <picture className={className}>
      <source type="image/webp" srcSet={pubPalMascotSrcSet(slug, kind, "webp")} sizes={`${size}px`} />
      <img
        src={pubPalMascotSrc(slug, kind, pubPalMascotFallbackSize(size), "png")}
        srcSet={pubPalMascotSrcSet(slug, kind, "png")}
        sizes={`${size}px`}
        alt={decorative ? "" : PUB_PAL_MASCOT_ALT}
        aria-hidden={decorative ? true : undefined}
        width={size}
        height={size}
        decoding="async"
        loading={lazy ? "lazy" : "eager"}
      />
    </picture>
  );
}
