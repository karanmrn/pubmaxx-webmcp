"use client";

import Link from "next/link";

import { trackEvent } from "@/lib/analytics";
import { buildCrawlMapHref } from "@/lib/crawlUrl";
import { venueMapUrl } from "@/lib/venueMapUrl";

/**
 * Guest handoff from the invite card to the map. One stop opens with `?sel=`;
 * two or more open the ordered crawl in build mode (`buildCrawlMapHref`).
 */
export default function InviteMapLink({ venueIds }: { venueIds: string[] }) {
  const ids = venueIds
    .map((venueId) => venueId.trim())
    .filter((venueId) => venueId.length > 0);
  if (ids.length === 0) return null;

  const href =
    ids.length >= 2
      ? buildCrawlMapHref(ids) ?? venueMapUrl(ids[0]!)
      : venueMapUrl(ids[0]!);

  return (
    <Link
      className="invite__mapLink"
      data-pressable
      href={href}
      onClick={() => trackEvent("invite_map_opened")}
    >
      Open these stops on the map
    </Link>
  );
}
