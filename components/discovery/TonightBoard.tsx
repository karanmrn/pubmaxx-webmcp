import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import HandleAvatar from "@/components/profile/HandleAvatar";
import prefetchVenue from "@/lib/prefetchVenue";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/curatedCrawls";
import { displayHandle } from "@/lib/handleDisplay";
import { relativeTime } from "@/lib/relativeTime";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { formatPrice } from "@/lib/venues";
import type { TonightEntry } from "@/lib/leaderboard";

// "Cheapest pints logged tonight" — a live, community-driven board of the
// cheapest Pint Drops reported in the trailing 24h (PRD §5.1). Purely
// presentational and prop-driven: the /discover page computes the entries from
// the community drops it already fetches and owns the data lifecycle. Each row
// is one venue's cheapest reported pint: the rank, the pub (linked into
// /map?sel=…), the stable £ price badge, the reporter's @handle, and a rough relative
// time. Prices are community-reported — labelled honestly, not authoritative.

type TonightBoardProps = {
  entries: TonightEntry[];
  caption?: string;
};


export default function TonightBoard({
  entries,
  caption = "Cheapest pints logged by the community in the last 24 hours, cheapest first.",
}: TonightBoardProps) {
  if (entries.length === 0) {
    return (
      <p className="discoverEmpty" role="status">
        No pints logged in the last 24h.{" "}
        <Link href={cityAwareMapPath(DEFAULT_CITY_ID)}>Be the first tonight</Link>.
      </p>
    );
  }

  return (
    <ol className="tonightBoard" aria-label={caption}>
      {entries.map((entry) => {
        const ago = relativeTime(entry.createdAt);
        const href = venueMapUrl(entry.venueId);
        return (
          <li key={entry.venueId} className="tonightRow" data-reveal>
            <span className="tonightRank" aria-hidden="true">
              {entry.rank}
            </span>
            <span className="srOnly">Rank {entry.rank}</span>

            <span className="tonightMain">
              <Link
                href={href}
                className="tonightPub"
                onPointerEnter={() => prefetchVenue(entry.venueId)}
                onTouchStart={() => prefetchVenue(entry.venueId)}
              >
                {entry.venueName}
              </Link>
              <span className="tonightMeta">
                {entry.handle ? (
                  <span className="tonightHandleRow">
                    <HandleAvatar
                      handle={entry.handle}
                      avatarUrl={entry.avatarUrl}
                      className="tonightAvatar"
                      imageClassName="tonightAvatar"
                      size={24}
                    />
                    <span className="tonightHandle">{displayHandle(entry.handle)}</span>
                  </span>
                ) : (
                  <span className="tonightHandle tonightHandleAnon">anon</span>
                )}
                {ago ? (
                  <>
                    <span className="tonightDot" aria-hidden="true">
                      ·
                    </span>
                    <time className="tonightAgo" dateTime={entry.createdAt}>
                      {ago}
                    </time>
                  </>
                ) : null}
              </span>
            </span>

            <PriceBadge variant="cheap" className="tonightPrice">
              {formatPrice(entry.priceGbp)}
            </PriceBadge>
          </li>
        );
      })}
    </ol>
  );
}
