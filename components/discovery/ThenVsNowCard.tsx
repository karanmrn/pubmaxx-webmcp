import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { formatPrice } from "@/lib/venues";
import type { ThenVsNowItem } from "@/lib/thenVsNow";

// A single "Then vs Now" price card: the pub name (linked into /map?sel=…), a
// compact baseline price next to the freshest community price, and the delta
// between them (↑ rust for dearer, ↓ sober-green for cheaper). Purely
// presentational and prop-driven — the /discover page computes the item and owns
// the fetch. The "Now" price is community-reported, so it is labelled honestly
// (not authoritative).

type ThenVsNowCardProps = {
  item: ThenVsNowItem;
};

// Round to the penny for the direction test so a £0.004 float wobble never
// paints a "went up" arrow on what is effectively no change.
function direction(deltaGbp: number): "up" | "down" | "flat" {
  const pennies = Math.round(deltaGbp * 100);
  if (pennies > 0) return "up";
  if (pennies < 0) return "down";
  return "flat";
}

export default function ThenVsNowCard({ item }: ThenVsNowCardProps) {
  const dir = direction(item.deltaGbp);
  const abs = Math.abs(item.deltaGbp);
  const pctAbs = Math.abs(item.pct);
  const href = venueMapUrl(item.venueId);

  // A screen-reader sentence that reads the movement plainly, out of context.
  const movementLabel =
    dir === "flat"
      ? `No change from the earlier ${formatPrice(item.thenGbp)} price.`
      : `${dir === "up" ? "Up" : "Down"} ${formatPrice(abs)} (${pctAbs.toFixed(
          0,
        )}%) from the earlier ${formatPrice(item.thenGbp)} price, community-reported.`;

  const DirIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  return (
    <article className="tvnCard" data-reveal>
      <h3 className="tvnName">
        <Link href={href} className="tvnLink">
          {item.venueName}
        </Link>
      </h3>

      <div className="tvnCompareRow">
        <div className="tvnPriceGroup">
          <span className="tvnPriceLabel">Then</span>
          <PriceBadge variant="baseline">{formatPrice(item.thenGbp)}</PriceBadge>
        </div>
        <span className="tvnArrow" aria-hidden="true">
          →
        </span>
        <div className="tvnPriceGroup">
          <span className="tvnPriceLabel">Now</span>
          <PriceBadge variant={dir === "up" ? "increase" : "current"}>
            {formatPrice(item.nowGbp)}
          </PriceBadge>
        </div>
      </div>

      <p className={`tvnDelta tvnDelta-${dir}`}>
        <DirIcon size={15} aria-hidden="true" />
        <span aria-hidden="true">
          {dir === "flat"
            ? "No change"
            : `${dir === "up" ? "+" : "−"}${formatPrice(abs)} (${pctAbs.toFixed(0)}%)`}
        </span>
        <span className="srOnly">{movementLabel}</span>
      </p>
    </article>
  );
}
