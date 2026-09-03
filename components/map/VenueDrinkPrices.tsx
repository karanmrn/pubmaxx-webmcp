"use client";

import CommunityPriceReport from "@/components/map/CommunityPriceReport";
import { ClaimBadge } from "@/components/map/venueInspectorBits";
import PriceBadge from "@/components/PriceBadge";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import {
  communityStampLabel,
  communityTrustNote,
  type CommunityPrice,
} from "@/lib/communityPrice";
import {
  drinkLaneLogActionLabel,
  drinkLaneLogInvite,
  orderVenueDrinkPrices,
} from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import {
  drinkLensEmptyVenueNote,
  type VenuePriceReadStatus,
} from "@/lib/mapExperienceLens";
import { COMMUNITY_PRICE_NOTE } from "@/lib/venues";
import { formatPrice } from "@/lib/venues";

import "./venueDrinkPrices.css";

/**
 * What drinkers have logged at ONE pub, one row per drink, the map's lane first.
 *
 * The sheet used to print a single community row: the freshest report of any
 * category. So a pub with a pint, a wine and a coffee on record showed one of
 * them, and which one depended on who logged last. A drinker reading a cocktail
 * map got a coffee figure at the top of the pub they had just tapped.
 *
 * Every row carries its OWN drink tag, its own figure, its own date and its own
 * standing, so no ordering can make one drink answer for another. The lane only
 * decides which row is read first, and its absence is what earns the one line
 * inviting a contribution.
 *
 * Deliberately UNGATED, like the row it replaces: this is what people reported,
 * so an uncorroborated or aged-out figure still shows here in full. What it
 * never does is imply the map moved with it - `communityTrustNote` says where
 * each figure actually stands.
 */
export default function VenueDrinkPrices({
  venueId,
  venueName,
  rows,
  activeLane,
  laneNoun,
  readStatus,
  communityPrices,
  onLogPrice,
  canLog,
  priceRevealMotionClass = "",
  revealRecord = false,
  revealRecordLate = false,
}: {
  venueId: string;
  venueName: string;
  /** The pub's freshest community price per drink, unfiltered by trust. */
  rows: readonly CommunityPrice[] | undefined;
  /** The drink the map is under. Its row leads; its absence is the invite. */
  activeLane: DrinkCategory;
  /** That lane inside a sentence: "no cocktail price logged here yet". */
  laneNoun: string;
  /** Still reading, could not read, or read and found none: three findings. */
  readStatus: VenuePriceReadStatus;
  communityPrices: CommunityPricesState;
  /** Bring the composer under the reader's thumb, already on this drink. */
  onLogPrice: () => void;
  /** False where this venue takes no community price (a bar, a restaurant). */
  canLog: boolean;
  priceRevealMotionClass?: string;
  revealRecord?: boolean;
  revealRecordLate?: boolean;
}) {
  const ordered = orderVenueDrinkPrices(rows, activeLane);
  const [lead, ...rest] = ordered;
  const laneRow = ordered.find((row) => row.inActiveLane) ?? null;
  // The empty statement is the shared helper's, so a read that failed or one
  // still running can never settle as "nobody has logged this here".
  const laneEmptyNote = laneRow
    ? null
    : drinkLensEmptyVenueNote(laneNoun, readStatus);
  const invite =
    laneRow || !canLog
      ? null
      : drinkLaneLogInvite(
          laneNoun,
          // One pub's own read is never partial: its rows arrive whole or not
          // at all, so the venue scale maps straight onto the index scale.
          readStatus,
        );

  if (!lead && !laneEmptyNote) return null;

  return (
    <section
      className="venueDrinkPrices"
      aria-label={`Drink prices logged at ${venueName}`}
    >
      {lead ? (
        <div className="contributorPrice communityPriceRow">
          <span className={priceRevealMotionClass || undefined}>
            <ClaimBadge kind="contributor" /> Logged by a Pubmaxxer
          </span>
          <PriceBadge variant="current">
            {formatPrice(lead.price.priceGbp)}
          </PriceBadge>
          <small
            className={
              [
                "communityPriceStamp",
                priceRevealMotionClass,
                revealRecord ? "venueRevealRecord" : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
            data-reveal-delay={revealRecord && !revealRecordLate ? "0" : undefined}
          >
            {lead.label} · {communityStampLabel(lead.price.submittedAt)}
          </small>
          {communityTrustNote(lead.price) ? (
            <small
              className={
                [
                  "communityPriceStanding",
                  priceRevealMotionClass,
                  revealRecord ? "venueRevealRecord" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              data-reveal-delay={revealRecord && !revealRecordLate ? "1" : undefined}
            >
              {communityTrustNote(lead.price)}
            </small>
          ) : null}
          <small className={`communityPriceNote ${priceRevealMotionClass}`.trim()}>
            {COMMUNITY_PRICE_NOTE}
          </small>
          <CommunityPriceReport
            price={lead.price}
            communityPrices={communityPrices}
            venueName={venueName}
          />
        </div>
      ) : null}

      {/* The pub's other drinks. Each is its own observation with its own tag,
          never a second reading of the figure above. */}
      {rest.length > 0 ? (
        <ul className="venueDrinkPricesList">
          {rest.map((row) => {
            const standing = communityTrustNote(row.price);
            return (
              <li key={`${venueId}-${row.category}`} className="venueDrinkPriceRow">
                <span className="venueDrinkPriceTag">{row.label}</span>
                <span className="venueDrinkPriceFigure">
                  {formatPrice(row.price.priceGbp)}
                </span>
                <span className="venueDrinkPriceStamp">
                  {communityStampLabel(row.price.submittedAt)}
                </span>
                {standing ? (
                  <span className="venueDrinkPriceStanding">{standing}</span>
                ) : null}
                <CommunityPriceReport
                  price={row.price}
                  communityPrices={communityPrices}
                  venueName={venueName}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {laneEmptyNote ? (
        <div className="venueDrinkPricesEmpty">
          <p className="venueDrinkPricesEmptyNote" role="status">
            {laneEmptyNote}
          </p>
          {invite ? (
            <>
              <p className="venueDrinkPricesInvite">{invite}</p>
              <button
                type="button"
                className="venueDrinkPricesLog"
                onClick={onLogPrice}
              >
                {drinkLaneLogActionLabel(laneNoun)}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
