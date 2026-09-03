"use client";

import AreaNewsRail from "@/components/desktop/AreaNewsRail";
import ConditionsChip from "@/components/desktop/ConditionsChip";
import DesktopRail from "@/components/desktop/DesktopRail";


// Desktop map right-rail (D3.1). Composes the shared DesktopRail host with the
// map's Conditions + Area-news slots. Mounted only at >=1024 with the venue
// drawer closed (PubMap gates it); the top-right positioning and the toolbar
// Conditions-chip swap live in mapDesktopRail.css. `area` is the Night Area slug
// under the current map view, or null when unknown — AreaNewsRail then renders
// nothing (fail-soft), and ConditionsChip likewise renders nothing until the
// weather has a verdict, so an empty rail is simply an invisible, empty stack.
export default function MapDesktopRail({ area }: { area: string | null }) {
  return (
    <DesktopRail
      className="mapRail"
      ariaLabel="Conditions and area news"
      conditions={<ConditionsChip />}
      areaNews={<AreaNewsRail area={area} />}
    />
  );
}
