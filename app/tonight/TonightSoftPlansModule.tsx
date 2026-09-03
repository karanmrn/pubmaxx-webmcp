import Link from "next/link";
import { ArrowRight, Camera, Coffee, Landmark, Leaf, Moon, Store, Waves } from "lucide-react";

import IntentLink from "@/components/nav/IntentLink";

import {
  CULTURE_CRAWL_CHIPS,
  CULTURE_CRAWL_MISSION,
  type CultureCrawlChipId,
} from "@/lib/cultureCrawl";
import {
  planOccasionHref,
  TONIGHT_SOFT_PLAN_CHIPS,
  type SoftPlanOccasionId,
} from "@/lib/planOccasion";

const CHIP_ICONS: Record<Exclude<SoftPlanOccasionId, "quiet">, typeof Coffee> = {
  coffee: Coffee,
  af: Leaf,
  chill: Moon,
};

const CULTURE_ICONS: Record<CultureCrawlChipId, typeof Coffee> = {
  "gallery-pint": Landmark,
  "market-kebab": Store,
  "river-historic": Waves,
  "sights-quiet": Camera,
};

type Props = {
  /** Heritage quiet-pint module is on the page below — link scrolls to it. */
  hasQuietPint?: boolean;
};

/**
 * Compact soft-plan handoff on /tonight during a quiet typical-pattern hour.
 * Plan links only; no invented listings.
 */
export default function TonightSoftPlansModule({ hasQuietPint = false }: Props) {
  return (
    <section
      className="tonightSoftPlans"
      aria-label="Soft plans tonight"
      data-testid="tonight-soft-plans"
    >
      <p className="tonightSoftPlansEyebrow">Soft plans tonight</p>
      <ul className="tonightSoftPlansList">
        {TONIGHT_SOFT_PLAN_CHIPS.map((chip) => {
          const Icon = CHIP_ICONS[chip.id];
          return (
            <li key={chip.id} className="tonightSoftPlansRow">
              <IntentLink
                href={planOccasionHref(chip.id, { src: "tonight-soft" })}
                className="tonightSoftPlansLink pressable"
              >
                <span className="tonightSoftPlansIcon" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className="tonightSoftPlansLabel">{chip.label}</span>
                <ArrowRight size={15} aria-hidden="true" className="tonightSoftPlansArrow" />
              </IntentLink>
            </li>
          );
        })}
        {hasQuietPint ? (
          <li className="tonightSoftPlansRow">
            <Link href="#tonight-quiet-pint" className="tonightSoftPlansLink pressable">
              <span className="tonightSoftPlansIcon" aria-hidden="true">
                <Moon size={17} />
              </span>
              <span className="tonightSoftPlansLabel">A quiet pint</span>
              <ArrowRight size={15} aria-hidden="true" className="tonightSoftPlansArrow" />
            </Link>
          </li>
        ) : null}
      </ul>
      <p className="tonightSoftPlansEyebrow tonightSoftPlansCultureEyebrow">
        {CULTURE_CRAWL_MISSION}
      </p>
      <ul className="tonightSoftPlansList">
        {CULTURE_CRAWL_CHIPS.map((chip) => {
          const Icon = CULTURE_ICONS[chip.id];
          return (
            <li key={chip.id} className="tonightSoftPlansRow">
              <IntentLink
                href={planOccasionHref(chip.id, { src: "tonight-culture" })}
                className="tonightSoftPlansLink pressable"
              >
                <span className="tonightSoftPlansIcon" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className="tonightSoftPlansLabel">{chip.label}</span>
                <ArrowRight size={15} aria-hidden="true" className="tonightSoftPlansArrow" />
              </IntentLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
