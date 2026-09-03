"use client";

import { useAuth } from "@/components/auth/AuthProvider";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { usePriceEvidenceMission } from "@/components/nearme/usePriceEvidenceMission";
import type { CommunityPriceMapReach } from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

import VenuePriceEntryPanel from "./VenuePriceEntryPanel";

export default function VenueSheetPriceEntry({
  venueId,
  venueName,
  isPub,
  communityPrices,
  canSubmitPrice,
  showSignInGate,
  authLoading,
  baselinePriceGbp,
  latestPintDropAt,
  focusRequest,
  includeSignals,
  laneCategory,
  mapReach,
  onLogged,
}: {
  venueId: string;
  venueName: string;
  isPub: boolean;
  communityPrices: CommunityPricesState;
  canSubmitPrice: boolean;
  showSignInGate: boolean;
  authLoading: boolean;
  baselinePriceGbp?: number | null;
  latestPintDropAt?: number | null;
  focusRequest?: number;
  includeSignals?: boolean;
  laneCategory?: DrinkCategory;
  mapReach?: CommunityPriceMapReach;
  onLogged?: (venueId: string) => void;
}) {
  const { user, handle, identityResolved } = useAuth();
  const { mission, dismiss, status } = usePriceEvidenceMission({
    venueIds: [venueId],
    enabled: Boolean(isPub && identityResolved && user && handle && canSubmitPrice),
    surface: "map",
  });

  return (
    <VenuePriceEntryPanel
      venueId={venueId}
      venueName={venueName}
      communityPrices={communityPrices}
      canSubmitPrice={canSubmitPrice}
      showSignInGate={showSignInGate}
      authLoading={authLoading}
      baselinePriceGbp={baselinePriceGbp}
      latestPintDropAt={latestPintDropAt}
      focusRequest={focusRequest}
      includeSignals={includeSignals}
      laneCategory={laneCategory}
      mapReach={mapReach}
      mission={mission?.venueId === venueId ? mission : null}
      missionPending={status === "loading"}
      onDismissMission={dismiss}
      onLogged={onLogged}
    />
  );
}
