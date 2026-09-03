import Link from "next/link";

import PricedLandingRows, {
  PricedLandingPublisher,
  formatPricedLandingCollectedDate,
} from "@/components/drinks/PricedLandingRows";
import type { DrinkBrandLanding } from "@/lib/drinkBrandLanding";
import {
  pricedLandingCountLabel,
  pricedLandingLogCta,
  pricedLandingMapArrivalRow,
  pricedLandingMapHref,
  type MapSelectableVenueIds,
  type PricedLandingBrandAreaLink,
} from "@/lib/pricedLanding";
import { formatPrice } from "@/lib/venues";

export default function DrinkBrandLandingContent({
  landing,
  mapSelectableVenueIds,
  areaPages = [],
}: {
  landing: DrinkBrandLanding;
  mapSelectableVenueIds: MapSelectableVenueIds;
  areaPages?: readonly PricedLandingBrandAreaLink[];
}) {
  const firstRow = landing.rows[0];
  const lowestPrice = formatPrice(firstRow.priceGbp);
  // `log=1` arms the composer for the RESOLVED venue, so the pub it names must
  // be one the map can open: the cheapest row inside the eager slim shard,
  // which is not always rank 1. With none, the link carries the brand alone and
  // the map offers its own picker rather than dropping a pub we named.
  const contributionRow = pricedLandingMapArrivalRow(
    landing.rows,
    mapSelectableVenueIds,
  );
  const mapHref = pricedLandingMapHref({ brandSlug: landing.slug });
  const contribution = pricedLandingLogCta({
    brandSlug: landing.slug,
    brandLabel: landing.brandLabel,
    venueId: contributionRow?.venueId,
    surface: "hero",
  });

  return (
    <div className="drinkBrandDirectory">
      <header className="drinkBrandDirectory__head">
        <p className="drinkBrandDirectory__eyebrow">
          <Link href="/map">London map</Link> <span aria-hidden="true">·</span>{" "}
          {landing.brandLabel}
        </p>
        <h1>Cheapest {landing.brandLabel} pints in London</h1>
        <p className="drinkBrandDirectory__from">
          <strong>From {lowestPrice}</strong>
          <PricedLandingPublisher
            className="drinkBrandDirectory__fromPublisher"
            row={firstRow}
            variant="hero"
          />
        </p>
        <p className="drinkBrandDirectory__summary">
          {landing.totalPricedVenues} pubs with listed {landing.brandLabel} pints. Collected{" "}
          {formatPricedLandingCollectedDate(landing.collectedAt)}.
        </p>
        <nav
          className="drinkBrandDirectory__actions"
          aria-label={`${landing.brandLabel} pint actions`}
        >
          <Link className="drinkBrandDirectory__primary" href={mapHref}>
            Find {landing.brandLabel} on the map
          </Link>
          <Link
            className="drinkBrandDirectory__secondary"
            href={contribution.href}
          >
            {contribution.label}
          </Link>
        </nav>
      </header>

      <section
        className="drinkBrandDirectory__prices"
        aria-labelledby="drink-brand-price-heading"
      >
        <div className="drinkBrandDirectory__sectionHead">
          <h2 id="drink-brand-price-heading">The pubs</h2>
          <span className="drinkBrandDirectory__sectionCount">
            {pricedLandingCountLabel(landing.totalPricedVenues, landing.rows.length)}
          </span>
        </div>
        <PricedLandingRows rows={landing.rows} />
      </section>

      {areaPages.length > 0 ? (
        <nav
          className="drinkBrandDirectory__areas"
          aria-label={`${landing.brandLabel} in other areas`}
        >
          <h2>By area</h2>
          <ul>
            {areaPages.map((page) => (
              <li key={page.href}>
                <Link href={page.href}>{page.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
