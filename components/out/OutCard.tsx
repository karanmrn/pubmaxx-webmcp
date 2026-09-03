import Link from "next/link";

import { SourceCredit } from "@/components/out/SourceCredit";
import { canonicalOutVenueId } from "@/lib/outDesktopGrouping";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * One Out listing.
 *
 * The card box is the LIST ITEM. A venue-resolved card links to that PUBMAXX
 * venue, while the publisher credit remains its own explicit external link.
 * An anchor inside an anchor is invalid HTML, so the credit may never be
 * nested inside the card link. An unmatched card stays visibly static rather
 * than pretending PUBMAXX has a venue destination it does not hold.
 */
export function ticketFromLine(row: WhatsOnRow): string | null {
  if (row.kind !== "event") return null;
  if (typeof row.priceGbp !== "number" || !Number.isFinite(row.priceGbp)) return null;
  const amount = row.priceGbp % 1 === 0 ? row.priceGbp.toFixed(0) : row.priceGbp.toFixed(2);
  return `Tickets from £${amount}`;
}

/**
 * A stated instant and a stated DATE are two different claims, so they print
 * differently. A listing that publishes no clock time gets "Sun 16 Aug" and no
 * time at all: inventing one is a fact the source does not carry.
 */
export function formatWhen(row: WhatsOnRow): string {
  if (row.startsAt) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(row.startsAt));
  }
  if (row.startsDate) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(`${row.startsDate}T12:00:00.000Z`));
  }
  return row.timeEvidence ?? "";
}

function pubMapHref(row: WhatsOnRow): string | null {
  const venueId = canonicalOutVenueId(row.venueId);
  return venueId ? `/map?sel=${encodeURIComponent(venueId)}` : null;
}

type OutCardTitleLevel = 2 | 4;

type OutCardBodyProps = {
  row: WhatsOnRow;
  onOpen?: () => void;
  titleLevel?: OutCardTitleLevel;
};

export function OutCardBody({ row, onOpen, titleLevel = 2 }: OutCardBodyProps) {
  const from = ticketFromLine(row);
  const when = row.startsAt || row.startsDate ? formatWhen(row) : "";
  const TitleTag = titleLevel === 4 ? "h4" : "h2";
  const mapHref = pubMapHref(row);
  const content = (
    <>
      <TitleTag>{row.title}</TitleTag>
      <p className="outCardMeta">
        {row.placeName}
        {when ? ` · ${when}` : ""}
      </p>
      {from ? <p className="outPrice">{from}</p> : null}
    </>
  );
  return (
    <>
      {mapHref ? (
        <Link className="outCard" href={mapHref} onClick={onOpen}>
          {content}
        </Link>
      ) : (
        <div className="outCard outCard--static">{content}</div>
      )}
      <SourceCredit source={row.source} />
    </>
  );
}

type OutCardProps = OutCardBodyProps;

export function OutCard({ row, onOpen }: OutCardProps) {
  return (
    <li>
      <OutCardBody row={row} onOpen={onOpen} />
    </li>
  );
}
