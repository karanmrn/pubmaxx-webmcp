import Link from "next/link";
import { ExternalLink, MapPinned } from "lucide-react";
import { firstHttps } from "@/lib/httpUrl";

import BookingClickAnalytics from "@/components/pubs/BookingClickAnalytics";
import PubsFilters, {
  type PubsFilterCounts,
  type PubsFilterKey,
} from "@/components/pubs/PubsFilters";
import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import VenueImage from "@/components/media/VenueImage";
import { categoryLabel, type DrinkCategory } from "@/lib/drinks";
import {
  SCRAPED_SOURCE_LABELS,
  type ScrapedPub,
} from "@/lib/scrapedPubs";
import { formatPrice } from "@/lib/venues";
import { pubsIndexHref } from "@/lib/pageFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { resolveBookingAction } from "@/lib/venueExternalActions";
import type { ZoneSelection } from "@/lib/zones";

import "./pubsGallery.css";
import "@/components/map/zonePicker.css";

export function pubsCountLabel({
  matchingPubs,
  filter,
  zone,
  page,
  totalPages,
  complete,
}: {
  matchingPubs: number;
  filter: PubsFilterKey;
  zone: ZoneSelection;
  page: number;
  totalPages: number;
  complete: boolean;
}): string {
  const count = `${matchingPubs} pub${matchingPubs === 1 ? "" : "s"}`;
  const parts = [complete && filter === "all" ? `${count} we've checked` : complete ? count : `${count} available`];
  if (filter !== "all") parts.push(SCRAPED_SOURCE_LABELS[filter]);
  if (zone !== "all") parts.push(`Zone ${zone}`);
  if (totalPages > 1) parts.push(`Page ${page} of ${totalPages}`);
  if (!complete) parts.push("Some chain data is unavailable");
  return parts.join(" · ");
}

function DrinkArt({
  accent,
  shelf,
  photoUrl,
  name,
}: {
  accent: DrinkCategory;
  shelf: DrinkCategory[];
  photoUrl?: string;
  name: string;
}) {
  return (
    <div
      className="pubsCardArt"
      data-drink={accent}
      style={{ ["--drink" as string]: `var(--cat-${accent})` }}
    >
      {photoUrl ? (
        <VenueImage
          className="pubsCardPhoto"
          sources={[{ url: photoUrl, provenance: "chain" }]}
          alt=""
          fill
        />
      ) : null}
      <div className="pubsCardArtWash" aria-hidden="true" />
      <div className="pubsCardGlyphHero" aria-hidden="true">
        <DrinkGlyph category={accent} size={72} inheritColor />
      </div>
      <ul className="pubsCardShelf" aria-label={`${categoryLabel(accent)} and more`}>
        <li>
          <DrinkGlyph category={accent} size={22} inheritColor />
          <span>{categoryLabel(accent)}</span>
        </li>
        {shelf.map((category) => (
          <li key={category}>
            <DrinkGlyph category={category} size={18} inheritColor />
            <span>{categoryLabel(category)}</span>
          </li>
        ))}
      </ul>
      <span className="pubsCardArtLabel">{name}</span>
    </div>
  );
}

export default function PubsGallery({
  pubs,
  matchingPubs,
  filter,
  zone,
  counts,
  zonesPresent,
  page,
  totalPages,
  complete,
}: {
  pubs: ScrapedPub[];
  matchingPubs: number;
  filter: PubsFilterKey;
  zone: ZoneSelection;
  counts: PubsFilterCounts;
  zonesPresent: number[];
  page: number;
  totalPages: number;
  complete: boolean;
}) {
  const boroughJumpTargets: { borough: string; id: string }[] = [];
  const seenBoroughs = new Set<string>();
  for (const pub of pubs) {
    const borough = pub.borough.trim();
    if (!borough || seenBoroughs.has(borough)) continue;
    seenBoroughs.add(borough);
    boroughJumpTargets.push({ borough, id: pub.id });
  }

  return (
    <div className="pubsGallery">
      <BookingClickAnalytics />
      <PubsFilters
        counts={counts}
        filter={filter}
        zone={zone}
        zonesPresent={zonesPresent}
        showCounts={complete}
      />

      <p className="pubsCount" aria-live="polite">
        {pubsCountLabel({ matchingPubs, filter, zone, page, totalPages, complete })}
      </p>

      {boroughJumpTargets.length > 1 ? (
        <nav className="pubsJumpNav" aria-label="Jump to area">
          {boroughJumpTargets.map(({ borough, id }) => (
            <a key={borough} className="pubsJumpChip" href={`#pubsCard-${id}`}>
              {borough}
            </a>
          ))}
        </nav>
      ) : null}

      <ul className="pubsGrid">
        {pubs.map((pub) => {
          const menuUrl = firstHttps(pub.menuUrl);
          const booking = resolveBookingAction({
            name: pub.name,
            bookingUrl: pub.bookingUrl,
            menuUrl: pub.menuUrl,
            areaHint: pub.borough,
          });
          const hasPhoto = Boolean(pub.photoUrl);
          const cardClassName = hasPhoto
            ? "pubsCard"
            : "pubsCard pubsCard--no-art";
          return (
            <li key={pub.id} id={`pubsCard-${pub.id}`} className={cardClassName}>
              {hasPhoto ? (
                <DrinkArt
                  accent={pub.drinkAccent}
                  shelf={pub.drinkShelf}
                  photoUrl={pub.photoUrl}
                  name={categoryLabel(pub.drinkAccent)}
                />
              ) : null}
              <div className="pubsCardBody">
                {!hasPhoto ? (
                  <p className="pubsCardDrink">
                    <DrinkGlyph category={pub.drinkAccent} size={18} inheritColor />
                    <span>{categoryLabel(pub.drinkAccent)}</span>
                  </p>
                ) : null}
                <div className="pubsCardMeta">
                  <span className="pubsSource" data-source={pub.source}>
                    {pub.sourceLabel}
                  </span>
                  {pub.borough ? <span className="pubsBorough">{pub.borough}</span> : null}
                  {pub.zone !== null ? (
                    <span className="pubsZone" title="Nearest station's fare zone">
                      Zone {pub.zone}
                    </span>
                  ) : null}
                </div>
                <h2 className="pubsCardName">
                  <Link href={venueMapUrl(pub.id)}>{pub.name}</Link>
                </h2>
                <p className="pubsCardPrice">
                  {pub.cheapestPrice != null
                    ? `From ${formatPrice(pub.cheapestPrice)}`
                    : "No price logged yet"}
                </p>
                <div className="pubsCardActions">
                  <Link className="pubsMapLink" href={venueMapUrl(pub.id)}>
                    <MapPinned size={14} aria-hidden="true" />
                    See on map
                  </Link>
                  {menuUrl ? (
                    <a
                      className="pubsMenuLink"
                      href={menuUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Menu
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  ) : null}
                  <a
                    className="pubsBookLink"
                    href={booking.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-booking-link="true"
                    data-tier={booking.tier}
                    data-venue-id={pub.id}
                  >
                    {booking.label}
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 ? (
        <nav className="pubsPagination" aria-label="Pub pages">
          {page > 1 ? (
            <Link
              className="pubsShowMoreBtn"
              href={pubsIndexHref({ source: filter, zone: zone === "all" ? null : zone, page }, page - 1)}
            >
              Previous
            </Link>
          ) : <span />}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link
              className="pubsShowMoreBtn"
              href={pubsIndexHref({ source: filter, zone: zone === "all" ? null : zone, page }, page + 1)}
            >
              Next
            </Link>
          ) : <span />}
        </nav>
      ) : null}

      {pubs.length === 0 ? (
        <p className="pubsEmpty">No pubs under that filter yet. Loosen it, or take it to the map.</p>
      ) : null}
    </div>
  );
}
