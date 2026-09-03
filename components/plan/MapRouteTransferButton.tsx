"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { transferMapRouteToDraft, type MapGeneratedRouteResponse } from "@/lib/mapRouteTransfer";

export type { MapGeneratedRouteResponse as MapRouteResponse } from "@/lib/mapRouteTransfer";

const PLAN_HREF = "/plan?src=mobile-route-preview";
const PLAN_LABEL = "Open Plan to lock it in";

/**
 * L12 transfer CTA. Behind the mapRouteTransfer flag (and only with a captured
 * Map Route), it writes the identical Route into the Plan draft the instant the
 * link is followed, so Plan hydrates the same Stops/order/anchor/proof without a
 * second generation request. With the flag off — or no Route to carry — it is
 * byte-identical to the legacy navigate-and-regenerate link.
 */
export function MapRouteTransferButton({
  response,
  mapRouteTransfer,
}: {
  response: MapGeneratedRouteResponse | null;
  mapRouteTransfer: boolean;
}) {
  if (!mapRouteTransfer || !response) {
    return (
      <Button asChild size="large" variant="secondary" className="w-full">
        <Link href={PLAN_HREF}>{PLAN_LABEL}</Link>
      </Button>
    );
  }

  const handleTransfer = () => {
    try {
      const storage = typeof window !== "undefined" ? window.localStorage : null;
      transferMapRouteToDraft(response, storage);
    } catch {
      // Fail-soft: a blocked or full store never blocks the journey — the link
      // still navigates and Plan falls back to its existing generation path.
    }
  };

  return (
    <Button asChild size="large" variant="secondary" className="w-full">
      <Link href={PLAN_HREF} onClick={handleTransfer}>{PLAN_LABEL}</Link>
    </Button>
  );
}
