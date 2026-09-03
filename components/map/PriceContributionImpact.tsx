"use client";

import { trackEvent } from "@/lib/analytics";
import type { CommunityPriceAttribution } from "@/lib/communityPrice";

type Props = {
  attribution: CommunityPriceAttribution;
};

export default function PriceContributionImpact({ attribution }: Props) {
  if (attribution.status !== "credited") return null;

  return (
    <div className="vpsubImpactRow">
      <p className="vpsubStampHint">
        Counted under <strong>@{attribution.handle}</strong> on the contributor
        record.
      </p>
      {/* A plain anchor, deliberately, and this is the one place in the tree
          where that is the right call.

          The obvious fix for a link inside the map sheet is a client
          transition, so leaving does not throw the camera, the filters and the
          MapLibre instance away. It was tried, twice: with IntentLink and with
          a bare next/link. Both landed on /u/<handle> with the FRAGMENT GONE,
          measured in e2e/price-submission (Chromium, production build). /map is
          one of the two CDN-cached documents with no nonce and /u/[handle] is
          nonce'd and dynamic, so this crossing is a hard navigation either way
          — and Next's own hard navigation drops the hash on the way.

          The fragment is the whole promise: "See your impact" that lands a
          reader at the top of a long profile has not shown them their impact.
          A document load costs the map; a lost anchor costs the destination.
          The destination wins, because the reader chose to leave. */}
      <a
        className="vpsubImpactLink"
        href={`/u/${encodeURIComponent(attribution.handle)}#contribution-impact`}
        onClick={() => trackEvent("price_impact_opened")}
      >
        See your impact
      </a>
    </div>
  );
}
