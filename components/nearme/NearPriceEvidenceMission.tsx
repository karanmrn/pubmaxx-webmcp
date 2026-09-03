"use client";

import { useMemo } from "react";

import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import type { NearMeCard } from "@/lib/nearMeAnswer";

import PriceEvidenceMissionSlot from "./PriceEvidenceMissionSlot";
import { usePriceEvidenceMission } from "./usePriceEvidenceMission";

export default function NearPriceEvidenceMission({
  cards,
  enabled,
}: {
  cards: readonly NearMeCard[];
  enabled: boolean;
}) {
  const venueIds = useMemo(() => cards.map((card) => card.id), [cards]);
  const names = useMemo(
    () => new Map(cards.map((card) => [card.id, card.name])),
    [cards],
  );
  const communityPrices = useCommunityPrices();
  const { mission, dismiss } = usePriceEvidenceMission({
    venueIds,
    enabled,
    surface: "near",
  });

  if (!enabled || !mission) return null;
  const venueName = names.get(mission.venueId) ?? "this pub";
  return (
    <PriceEvidenceMissionSlot
      mission={mission}
      venueName={venueName}
      surface="near"
      communityPrices={communityPrices}
      onDismiss={dismiss}
    />
  );
}
