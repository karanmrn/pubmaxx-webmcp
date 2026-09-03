import Link from "next/link";

import { planOccasionHref } from "@/lib/planOccasion";

type Props = {
  /** Own beacon on You vs a crew mate's profile line. */
  variant: "self" | "crew";
};

/**
 * Quiet handoff from the friends-only out-tonight beacon into a soft plan.
 * Friends-gated by the parent: only mounts on mutual-follow surfaces.
 */
export default function OutTonightPlanCta({ variant }: Props) {
  const href = planOccasionHref("quiet", { src: "out-tonight" });
  const label = variant === "self" ? "Plan with your lot" : "Start a soft plan";

  return (
    <p className="beaconPlanCta">
      <Link className="beaconPlanCtaLink" href={href}>
        {label}
      </Link>
    </p>
  );
}
