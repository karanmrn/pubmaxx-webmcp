"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MapPin, Sparkles } from "lucide-react";

import { useAuth } from "@/components/auth/AuthProvider";
import PriceBadge from "@/components/PriceBadge";
import CommunityPriceReport from "@/components/map/CommunityPriceReport";
import VenueSheetPriceEntry from "@/components/map/inspector/VenueSheetPriceEntry";
import {
  freshestCommunityPrice,
  type CommunityPricesState,
} from "@/components/map/useCommunityPrices";
import { ClaimBadge } from "@/components/map/venueInspectorBits";
import {
  communityStampLabel,
  communityTrustNote,
  submitCategoryLabel,
} from "@/lib/communityPrice";
import { DEFAULT_DRINK_LANE } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import { parsePublicOverlay, type PublicHarvestOverlay } from "@/lib/harvestFold";
import { discardBody } from "@/lib/responseBody";
import type { UkBasePub } from "@/lib/ukBasePubs";
import { COMMUNITY_PRICE_NOTE, formatPrice } from "@/lib/venues";
import {
  drinkLensEmptyVenueNote,
  drinkLensPriceNoun,
  NO_ALCOHOL_LENS_PRICE_NOUN,
  type MapExperienceLens,
} from "@/lib/mapExperienceLens";

import "./unverifiedPubSheet.css";

// The sheet behind a UK base pin - a pub OpenStreetMap knows about but the
// curated venue index does not. It shows existing community reports or invites
// the first one. A lone fresh pint report MARKS this pin, so the copy may say
// so; it can never COLOUR it, because base features carry no band, no cheapest
// price and no pin label, and the price merge never reaches a `venue-uk-*` id.
// Hence reach "mark" everywhere below: the mark is real, the colour is not, and
// promising the colour to the first drinker in an uncovered town would be a
// promise this layer cannot keep.

type UnverifiedPubSheetProps = {
  pub: UkBasePub;
  communityPrices: CommunityPricesState;
  experienceLens?: MapExperienceLens;
  /** Selected-drink map lens (e.g. coffee). Never the no-alcohol experience. */
  drinkLensCategory?: DrinkCategory | null;
};

export function HarvestOverlayFields({ overlay }: { overlay: PublicHarvestOverlay }) {
  const hasLinks = Boolean(overlay.website || overlay.menuUrl);
  if (!hasLinks && !overlay.lore) return null;
  return (
    <div className="unverifiedPubOverlay">
      {hasLinks ? (
        <div className="unverifiedPubActions">
          {overlay.website ? (
            <a href={overlay.website} target="_blank" rel="noopener noreferrer">
              Pub website
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
          {overlay.menuUrl ? (
            <a href={overlay.menuUrl} target="_blank" rel="noopener noreferrer">
              Look at the menu
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
      {overlay.lore ? (
        <div className="unverifiedPubLore">
          <p>{overlay.lore.fact}</p>
          <div className="unverifiedPubLoreMeta">
            <span>Web</span>
            <a href={overlay.lore.sourceRef} target="_blank" rel="noopener noreferrer">
              Source
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function UnverifiedPubSheet({
  pub,
  communityPrices,
  experienceLens = "all",
  drinkLensCategory = null,
}: UnverifiedPubSheetProps) {
  const { user, loading: authLoading, configured: authConfigured } = useAuth();
  const [overlay, setOverlay] = useState<PublicHarvestOverlay | null>(null);
  const readStatus = communityPrices.venuePriceStatus.get(pub.id) ?? "idle";
  const pricesKnown = readStatus === "ready";
  const readFailed = readStatus === "degraded";
  const rows = communityPrices.byVenueId.get(pub.id);
  const communityPrice = freshestCommunityPrice(
    experienceLens === "food"
      ? undefined
      : experienceLens === "no-alcohol"
      ? rows?.filter(
          (row) =>
            row.drinkCategory === "soft-drink" ||
            row.drinkCategory === "alcohol-free",
        )
      : drinkLensCategory
        ? rows?.filter((row) => row.drinkCategory === drinkLensCategory)
        : rows,
  );
  const communityTrustStanding = communityPrice
    ? communityTrustNote(communityPrice, undefined, "mark")
    : "";
  const drinkLensNoun = drinkLensCategory
    ? drinkLensPriceNoun(drinkLensCategory)
    : null;

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) setOverlay(null);
    });
    (async () => {
      try {
        const res = await fetch(
          `/api/harvest-overlay?venueId=${encodeURIComponent(pub.id)}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { overlay?: unknown };
        const parsed = parsePublicOverlay(body.overlay);
        if (!parsed) return;
        void Promise.resolve().then(() => {
          if (!controller.signal.aborted) setOverlay(parsed);
        });
      } catch {
        /* fail-soft: overlay unknown */
      }
    })();
    return () => controller.abort();
  }, [pub.id]);

  return (
    <div className="unverifiedPub">
      <div className="unverifiedPubHead">
        <span className="unverifiedPubTag">
          <Sparkles size={12} aria-hidden="true" />
          {communityPrice
            ? "Community price"
            : pricesKnown
              ? "No price yet"
              : readFailed
                ? "Prices unread"
                : "Checking community prices"}
        </span>
        <h2 className="unverifiedPubName">{pub.name}</h2>
        {pub.address ? (
          <p className="unverifiedPubAddress">
            <MapPin size={13} aria-hidden="true" />
            {pub.address}
          </p>
        ) : null}
      </div>

      {communityPrice ? (
        <>
          <p className="unverifiedPubLead">
            We know this pub from OpenStreetMap. Here is what the community last
            logged.
          </p>
          <div className="contributorPrice communityPriceRow">
            <span>
              <ClaimBadge kind="contributor" /> Logged by a Pubmaxxer
            </span>
            <PriceBadge variant="current">
              {formatPrice(communityPrice.priceGbp)}
            </PriceBadge>
            <small className="communityPriceStamp">
              {submitCategoryLabel(communityPrice.drinkCategory)} ·{" "}
              {communityStampLabel(communityPrice.submittedAt)}
            </small>
            {communityTrustStanding ? (
              <small className="communityPriceStanding">{communityTrustStanding}</small>
            ) : null}
            <small className="communityPriceNote">{COMMUNITY_PRICE_NOTE}</small>
            <CommunityPriceReport
              price={communityPrice}
              communityPrices={communityPrices}
              venueName={pub.name}
            />
          </div>
        </>
      ) : pricesKnown && experienceLens === "no-alcohol" ? (
        <p className="unverifiedPubLead">
          {drinkLensEmptyVenueNote(NO_ALCOHOL_LENS_PRICE_NOUN, "ready")}
        </p>
      ) : drinkLensNoun ? (
        <p className="unverifiedPubLead">
          {drinkLensEmptyVenueNote(drinkLensNoun, readStatus)}
        </p>
      ) : pricesKnown && experienceLens === "food" ? (
        <p className="unverifiedPubLead">
          No sourced food price recorded here.
        </p>
      ) : pricesKnown ? (
        <p className="unverifiedPubLead">
          We know this pub is here, and that is all we know. Nobody has logged what
          a drink costs - <strong>be the first</strong>.
        </p>
      ) : readFailed ? (
        <p className="unverifiedPubLead">
          We could not read what has been logged here just now. You can still add
          tonight&rsquo;s price below.
        </p>
      ) : null}

      {overlay ? <HarvestOverlayFields overlay={overlay} /> : null}

      <VenueSheetPriceEntry
        key={pub.id}
        venueId={pub.id}
        venueName={pub.name}
        isPub
        communityPrices={communityPrices}
        canSubmitPrice={!authConfigured || Boolean(user)}
        showSignInGate
        authLoading={authLoading}
        mapReach="mark"
        laneCategory={drinkLensCategory ?? DEFAULT_DRINK_LANE}
      />

      {/* ODbL requires attribution wherever these pins are publicly displayed
          (data/osm/uk/README.md), and it is also the honest provenance line:
          the pub's existence is sourced, its price is not. */}
      <p className="unverifiedPubSource">
        Pub location from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL. Prices never come from OpenStreetMap.
      </p>
    </div>
  );
}
