"use client";

import type { ReactNode } from "react";

import { trackEvent } from "@/lib/analytics";
import {
  buildGetHomeHandoffLinks,
  getHomeHandoffHeading,
  type GetHomeHandoffVenue,
} from "@/lib/getHomeHandoff";
import type { CrawlEnding } from "@/lib/plan";
import type { LastPintDecisionKind } from "@/lib/tfl";

import "./getHomeHandoff.css";
import "./routeEndingCard.css";

export type RouteEndingId = CrawlEnding;

export type RouteEndingOption = {
  id: RouteEndingId;
  title: string;
  description: string;
  actionLabel: string;
  /** Marks the neutral default when no recommendation id is supplied. */
  recommended?: boolean;
};

export type RouteEndingOptions = readonly [
  RouteEndingOption,
  RouteEndingOption,
  RouteEndingOption,
];

export type RouteEndingCardProps = {
  /** Optional Pub Pal or server-ranked copy; the card still works without it. */
  options?: RouteEndingOptions;
  /** Overrides an option's recommended flag when a planner has a fresh signal. */
  recommendedId?: RouteEndingId;
  /** The card never executes an ending on render; callers decide what a tap does. */
  onChoose: (ending: RouteEndingId) => void;
  title?: string;
  description?: ReactNode;
  className?: string;
};

export const DEFAULT_ROUTE_ENDINGS = [
  {
    id: "food",
    title: "Find food",
    description: "Grab a late bite nearby.",
    actionLabel: "Find food",
  },
  {
    id: "get_home",
    title: "Get home",
    description: "Check the way back while the night is still easy.",
    actionLabel: "Plan the trip",
    recommended: true,
  },
  {
    id: "keep_going",
    title: "Keep going",
    description: "Carry on to the next saved stop.",
    actionLabel: "Continue crawl",
  },
] as const satisfies RouteEndingOptions;

export type GetHomeHandoffRowProps = {
  venue: GetHomeHandoffVenue;
  decision?: LastPintDecisionKind | null;
};

export function GetHomeHandoffRow({
  venue,
  decision = null,
}: GetHomeHandoffRowProps): React.JSX.Element | null {
  const links = buildGetHomeHandoffLinks(venue, decision);
  if (links.length === 0) return null;

  const heading = getHomeHandoffHeading(venue);

  return (
    <section className="getHomeHandoff" aria-label={heading}>
      <p className="getHomeHandoff__heading">{heading}</p>
      <div className="getHomeHandoff__actions">
        {links.map((link) => (
          <a
            key={link.kind}
            className="getHomeHandoff__link"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("planned_night_action", { type: "get_home" })}
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}

function recommendedEndingId(
  options: RouteEndingOptions,
  requestedId: RouteEndingId | undefined,
): RouteEndingId {
  if (requestedId && options.some((option) => option.id === requestedId)) {
    return requestedId;
  }

  return options.find((option) => option.recommended)?.id ?? options[1].id;
}

function optionAriaLabel(option: RouteEndingOption, isRecommended: boolean): string {
  return `${option.title}. ${option.description} ${option.actionLabel}.${isRecommended ? " Recommended." : ""}`;
}

export function RouteEndingCard({
  options = DEFAULT_ROUTE_ENDINGS,
  recommendedId,
  onChoose,
  title = "How do you want to finish?",
  description = "Choose the next move for the crawl. Your route stays yours.",
  className,
}: RouteEndingCardProps): React.JSX.Element {
  const recommendedIdForCard = recommendedEndingId(options, recommendedId);
  const rootClassName = ["routeEndingCard", className].filter(Boolean).join(" ");

  return (
    <section className={rootClassName} aria-label="Crawl ending">
      <header className="routeEndingCard__header">
        <p className="routeEndingCard__eyebrow">Crawl ending</p>
        <h2 className="routeEndingCard__title">{title}</h2>
        <p className="routeEndingCard__description">{description}</p>
      </header>

      <div className="routeEndingCard__choices" role="group" aria-label="Choose how to finish">
        {options.map((option) => {
          const isRecommended = option.id === recommendedIdForCard;

          return (
            <button
              key={option.id}
              type="button"
              className="routeEndingCard__choice"
              data-ending={option.id}
              data-recommended={isRecommended ? "true" : undefined}
              aria-label={optionAriaLabel(option, isRecommended)}
              onClick={() => onChoose(option.id)}
            >
              <span className="routeEndingCard__choiceTop">
                <span className="routeEndingCard__choiceTitle">{option.title}</span>
                {isRecommended ? (
                  <span className="routeEndingCard__recommendation">Recommended</span>
                ) : null}
              </span>
              <span className="routeEndingCard__choiceDescription">{option.description}</span>
              <span className="routeEndingCard__action">{option.actionLabel}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default RouteEndingCard;
