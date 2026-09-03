"use client";

import { Flag } from "lucide-react";

import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";

// The complaint affordance on a community price row - the same shape, class and
// vocabulary as the Pint Drop report button, because it is the same promise:
// anyone can flag anything a stranger wrote about a pub.
//
// What it deliberately does NOT do is remove the row. A reported Pint Drop
// vanishes locally because drops auto-hide at a report threshold; a community
// price does not, and cannot - it is the figure the map is made of, and an
// anonymous one-tap eraser would be a griefer's tool. So the button records the
// flag for a human (POST /api/price-submit { action: "report" }) and then says
// so plainly rather than implying a takedown that has not happened.
//
// Renders nothing for a price with no id: an optimistic entry the server has
// not answered for yet has nothing to report.

type CommunityPriceReportProps = {
  price: CommunityPrice;
  communityPrices: CommunityPricesState;
  /** Pub name, for the button's accessible label. */
  venueName: string;
};

export default function CommunityPriceReport({
  price,
  communityPrices,
  venueName,
}: CommunityPriceReportProps) {
  const id = price.id;
  if (!id) return null;
  if (communityPrices.reportedIds.has(id)) {
    return (
      <small className="communityPriceReported" role="status">
        Reported. We&rsquo;ll take a look.
      </small>
    );
  }
  const error = communityPrices.reportErrors?.get(id);
  return (
    <span>
      <button
        type="button"
        className="reportBtn"
        onClick={() => communityPrices.reportPrice(id)}
        aria-label={`Report this community price at ${venueName}`}
      >
        <Flag size={12} aria-hidden="true" /> Report
      </button>
      {error ? <small role="status">{error}</small> : null}
    </span>
  );
}
