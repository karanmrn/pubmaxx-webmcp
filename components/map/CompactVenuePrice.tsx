import type { CompactVenueAnchor } from "@/lib/venueAnchorPresentation";

export default function CompactVenuePrice({
  priceLabel,
  anchor,
  className,
  provenanceClassName,
}: {
  priceLabel: string;
  anchor: CompactVenueAnchor | null;
  className?: string;
  provenanceClassName?: string;
}) {
  if (!anchor) return <span className={className}>{priceLabel}</span>;

  return (
    <span className={className}>
      <span>
        {anchor.label} · {priceLabel}
      </span>
      <small className={provenanceClassName}>
        {anchor.observedLabel} · {anchor.sourceLabel}
      </small>
    </span>
  );
}
