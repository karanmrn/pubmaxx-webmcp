"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Camera, Tag } from "lucide-react";

import {
  communityReachNote,
  formatPriceDay,
  marksMapProvisionally,
  paintsMap,
  COMMUNITY_PRICE_MAX_GBP,
  DEFAULT_SUBMIT_CATEGORY,
  submitCategoryLabel,
  validateCommunityPrice,
  type CommunityPrice,
  type CommunityPriceAttribution,
  type CommunityPriceMapReach,
} from "@/lib/communityPrice";
import { drinkLaneNoun, submitCategoriesForLane } from "@/lib/drinkLanes";
import { formatPriceGbp, QUICK_ADD_PRICES_GBP } from "@/lib/spill";
import { mergePriceChips } from "@/lib/spillPreview";
import type { DrinkCategory } from "@/lib/drinks";
import { formatPrice } from "@/lib/venues";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { useContributionGate } from "@/components/identity/ContributionGateDialog";
import { trackEvent } from "@/lib/analytics";
import PriceContributionImpact from "@/components/map/PriceContributionImpact";
import type { MissionSurface } from "@/lib/analyticsEvents";
import {
  effectiveSubmitCategory,
  holdSubmitCategory,
  missionAnalyticsProps,
  missionNamedCategory,
  missionReceiptFromReadback,
  type MissionReceipt,
  type PriceEvidenceMissionReason,
} from "@/lib/priceEvidenceMissions";

const PINT_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
const PINT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type VenuePriceSubmitMission = {
  reason: PriceEvidenceMissionReason;
  drinkCategory?: DrinkCategory;
  surface: MissionSurface;
};

// The word-of-mouth moment: you're standing in the pub, you tap what you're
// drinking, you type what it cost, and the map restamps under your thumb.
//
// Deliberately NOT the Pint Drop composer. That is the full social object - a
// handle, photos, a note, a visibility lane, a destination. This is the
// twenty-second version for the person at the bar: category, price, done. The
// Price-entry surfaces check account state before mounting it, so nobody
// types a price and only then learns they need to sign in.
//
// Provenance is first-class, not decoration: the confirmation shows the price
// with its own dated "today · community" badge, and the scraped/sourced
// baseline keeps rendering underneath it untouched. Nothing here overwrites a
// dataset price - the submission is an additional dated observation.
//
// And the receipt tells the truth about REACH, not just about landing. Since
// the trust wave a lone report is on the pub's page but not on the map, so both
// the receipt and the pre-submit note say so rather than promising a restamp
// this tap has not earned yet (lib/communityPrice.ts owns the policy).

type VenuePriceSubmitProps = {
  venueId: string;
  venueName: string;
  /** Community prices layer - owns the restamp and the POST. */
  communityPrices: CommunityPricesState;
  /** The venue's price on record, used to lead the quick-tap chips. */
  baselinePriceGbp?: number | null;
  /**
   * Epoch ms of the venue's latest Pint Drop, from the SAME unmerged drop
   * signal mergeCommunityPriceSignals consults - a drop newer than the map
   * candidate outranks it in the merge, so the receipt must not claim the map
   * in that case either. Null/undefined reads as "no drop we can date".
   */
  latestPintDropAt?: number | null;
  /**
   * How far this pub's pin can carry a community price. Curated venues paint
   * (mark now, colour once corroborated). A UK base pin passes "mark": the dot
   * really does draw, and no corroboration ever gives it a colour, so the
   * receipt must claim the first and never the second.
   */
  mapReach?: CommunityPriceMapReach;
  /** Increment to bring this existing form under the drinker's thumb. */
  focusRequest?: number;
  /**
   * The drink the map is under, so the composer opens on what the reader came
   * to log. It also joins the chip row when the shortcut list omits it (gin,
   * rum, vodka), because a lane you cannot see is a lane you cannot log.
   */
  laneCategory?: DrinkCategory;
  /**
   * A ranked evidence mission. Locks the known category, leaves the price
   * blank, and hides one-tap agreement chips. Receipts come from the
   * authoritative write-back, never from this client reason.
   */
  mission?: VenuePriceSubmitMission | null;
  /**
   * The sheet mounts this form before its mission read answers. Hold Log it
   * until that read lands or times out, or a typed price is submitted under
   * a drink that arrived after typing began.
  */
  missionPending?: boolean;
  /** Refresh this venue's Pint Drops after a successful Log it. */
  onLogged?: (venueId: string) => void;
};

/**
 * The freshest community price for the chosen category, or null. Read from the
 * shared layer so the confirmation and the pin can never disagree.
 */
function priceForCategory(
  rows: CommunityPrice[] | undefined,
  category: DrinkCategory,
): CommunityPrice | null {
  return rows?.find((row) => row.drinkCategory === category) ?? null;
}

export default function VenuePriceSubmit({
  venueId,
  venueName,
  communityPrices,
  baselinePriceGbp = null,
  latestPintDropAt = null,
  mapReach = "paint",
  focusRequest = 0,
  laneCategory = DEFAULT_SUBMIT_CATEGORY,
  mission = null,
  missionPending = false,
  onLogged,
}: VenuePriceSubmitProps) {
  const titleId = `vpsubTitle-${venueId}`;
  const priceInputRef = useRef<HTMLInputElement>(null);
  // A mission's own drink outranks anything held here. The sheet mounts this
  // form before its mission read answers, so a locked drink read off state set
  // at mount would name the lane while the heading named the mission.
  const missionCategory = mission ? missionNamedCategory(mission) : null;
  const missionLocksCategory = missionCategory !== null;
  // The lane is the opening choice, not a lock: the reader can still tap any
  // other drink. Keyed per venue by the parent, so switching pubs re-opens on
  // the lane rather than on whatever the last pub was left showing.
  const [chosenCategory, setCategory] = useState<DrinkCategory>(
    missionCategory ?? laneCategory,
  );
  // The drink the figure on screen was entered under. A mission arriving after
  // typing began may rename the heading, never this.
  const [heldCategory, setHeldCategory] = useState<DrinkCategory | null>(null);
  const category = effectiveSubmitCategory({
    held: heldCategory,
    mission: missionCategory,
    chosen: chosenCategory,
  });
  const missionAsksAnother =
    missionCategory !== null && missionCategory !== category;
  const categories = useMemo(
    () => submitCategoriesForLane(laneCategory),
    [laneCategory],
  );
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pintPhoto, setPintPhoto] = useState<File | null>(null);
  const pintPhotoInputRef = useRef<HTMLInputElement>(null);

  function enterPrice(next: string) {
    setPrice(next);
    setHeldCategory((held) =>
      holdSubmitCategory({ held, nextPrice: next, visible: category }),
    );
    setError(null);
  }

  // Which drink this viewer just logged, so the receipt celebrates THEIR tap.
  // The dated community price itself is shown in the price block above by
  // VenueOverviewTab for every reader, submitter or not.
  const [logged, setLogged] = useState<{
    category: DrinkCategory;
    attribution: CommunityPriceAttribution;
    missionReceipt?: MissionReceipt;
  } | null>(null);
  const { requestContribution, contributionGateDialog } =
    useContributionGate();

  const { byVenueId, submit, submitting } = communityPrices;

  // Changing the map's drink while this sheet is open is an explicit act, so
  // the composer follows it. A tap on a chip in between is not overwritten:
  // only a CHANGE of lane moves the choice.
  const laneSeenRef = useRef<DrinkCategory>(laneCategory);
  useEffect(() => {
    if (missionLocksCategory) return;
    if (laneSeenRef.current === laneCategory) return;
    laneSeenRef.current = laneCategory;
    setCategory(laneCategory);
    setHeldCategory((held) => (held === null ? null : laneCategory));
    setError(null);
  }, [laneCategory, missionLocksCategory]);

  useEffect(() => {
    if (focusRequest <= 0) return;
    let focusFrame = 0;
    const focusTimer = window.setTimeout(() => {
      focusFrame = window.requestAnimationFrame(() => {
        priceInputRef.current?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
        priceInputRef.current?.focus();
      });
    }, 120);
    return () => {
      window.clearTimeout(focusTimer);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [focusRequest]);

  // The receipt: the freshest community price for the chosen drink. The
  // optimistic submit writes into this same layer, so it appears the instant
  // the button is tapped - the restamp is not a second, local copy of the fact.
  const stamped = priceForCategory(byVenueId.get(venueId), category);

  // The venue's price on record leads the chips - one tap on the likeliest
  // answer beats typing, and a correction is usually a few pence away from it.
  // Three fit one row at 390px; a fourth wraps and the block stops reading as
  // a single row of shortcuts.
  const quickPrices = useMemo(
    () => mergePriceChips(QUICK_ADD_PRICES_GBP, baselinePriceGbp).slice(0, 3),
    [baselinePriceGbp],
  );
  // Left to the React Compiler rather than a manual useMemo: `category` is
  // derived per render by `effectiveSubmitCategory`, which the compiler cannot
  // accept as a hand-written dependency.
  const priceValidation = validateCommunityPrice({
    venueId,
    drinkCategory: category,
    priceGbp: price,
  });
  const validationError =
    price.trim() !== "" && !priceValidation.ok ? priceValidation.error : null;
  const visibleError = error ?? validationError;

  function clearPintPhoto() {
    setPintPhoto(null);
    if (pintPhotoInputRef.current) pintPhotoInputRef.current.value = "";
  }

  function onPintPhotoChosen(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Photos must be JPEG, PNG, or WebP.");
      clearPintPhoto();
      return;
    }
    if (file.size > PINT_PHOTO_MAX_BYTES) {
      setError("Each photo must be under 5MB.");
      clearPintPhoto();
      return;
    }
    setError(null);
    setPintPhoto(file);
  }

  // What this tap actually did to the map, asked of the same predicates the map
  // itself obeys - `paintsMap` for the price, `marksMapProvisionally` for the
  // badge - so the receipt can never claim a reach the pin does not have.
  const markedProvisionally =
    mapReach !== "page" && stamped ? marksMapProvisionally(stamped) : false;
  const stampStanding = !stamped
    ? ""
    : mapReach === "paint" && paintsMap(stamped, latestPintDropAt)
      ? "On the map"
      : markedProvisionally
        ? "Marked on the map"
        : "On this pub’s page";

  async function logPrice() {
    // The Enter key reaches here even while the button is disabled; one
    // submission at a time keeps the optimistic rollback snapshots coherent.
    if (submitting || missionPending || !priceValidation.ok) return;
    setError(null);
    await requestContribution(async (auth) => {
      const result = await submit({
        venueId,
        drinkCategory: category,
        priceGbp: price,
        pintPhoto,
      }, auth);
      if (!result.ok) {
        trackEvent("price_submit_failed", { category, reason: result.reason });
        if (result.status) {
          return {
            status: result.status,
            error: result.error,
          };
        }
        setError(result.error);
        return;
      }
      trackEvent("price_submitted", { category });
      const missionReceipt = mission
        ? missionReceiptFromReadback({ price: result.price })
        : undefined;
      if (mission && missionReceipt) {
        const analytics = missionAnalyticsProps(mission.surface, {
          reason: mission.reason,
          drinkCategory: category,
        }, { outcome: missionReceipt.outcome });
        trackEvent("mission_submitted", analytics);
        if (missionReceipt.outcome === "trusted") {
          trackEvent("mission_newly_trusted", analytics);
        }
      }
      setLogged({
        category,
        attribution: result.attribution,
        missionReceipt,
      });
      setPrice("");
      setHeldCategory(null);
      clearPintPhoto();
      onLogged?.(venueId);
    });
  }

  return (
    <section
      id={`venue-price-submit-${venueId}`}
      className="venuePriceSubmit"
      aria-labelledby={titleId}
    >
      <div className="vpsubHead">
        <Tag size={15} aria-hidden="true" />
        <h3 id={titleId} className="vpsubTitle">
          What&rsquo;s it tonight?
        </h3>
      </div>

      {missionLocksCategory ? (
        <>
          <p className="vpsubLockedDrink">{submitCategoryLabel(category)}</p>
          {missionAsksAnother ? (
            <p className="vpsubHeldDrink">
              {`Clear the price to log ${drinkLaneNoun(missionCategory)} instead.`}
            </p>
          ) : null}
        </>
      ) : (
        <div
          className="vpsubCats"
          role="radiogroup"
          aria-label={`What are you drinking at ${venueName}?`}
        >
          {categories.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={category === option}
              className={category === option ? "vpsubCat vpsubCatOn" : "vpsubCat"}
              onClick={() => {
                // The receipt belongs to the drink it was logged for, so
                // switching categories shows that category's own record.
                setCategory(option);
                setHeldCategory((held) => (held === null ? null : option));
                setError(null);
              }}
            >
              {submitCategoryLabel(option)}
            </button>
          ))}
        </div>
      )}

      <div className="vpsubEntry">
        <div className="vpsubField">
          <span className="vpsubCurrency" aria-hidden="true">
            £
          </span>
          {/* The field's accessible name takes the SENTENCE noun, not the chip
              label: the chips are menu-section names, so lowercasing one read
              out as "price of a cocktails". The lane table owns the singular. */}
          <input
            ref={priceInputRef}
            className="vpsubInput"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="4.20"
            value={price}
            maxLength={6}
            aria-label={`Price of a ${drinkLaneNoun(category)} at ${venueName}, in pounds`}
            aria-invalid={visibleError !== null}
            aria-describedby={visibleError ? "vpsubError" : undefined}
            onChange={(event) => {
              // Keep the field to what a price can be as you type - digits and
              // one separator - so the keypad can't produce an unparseable value.
              enterPrice(event.target.value.replace(/[^\d.,]/g, ""));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void logPrice();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="vpsubLog"
          onClick={() => void logPrice()}
          disabled={submitting || missionPending || !priceValidation.ok}
        >
          {missionPending ? "Checking..." : submitting ? "Logging…" : "Log it"}
        </button>
      </div>

      {missionLocksCategory ? null : (
        <div className="vpsubQuick" aria-label="Common prices">
          {quickPrices.map((value) => (
            <button
              key={value}
              type="button"
              className="vpsubQuickChip"
              onClick={() => {
                enterPrice(formatPriceGbp(value));
              }}
            >
              {formatPrice(value)}
            </button>
          ))}
        </div>
      )}

      <div className="vpsubPhotoRow">
        <input
          ref={pintPhotoInputRef}
          className="vpsubPhotoInput"
          type="file"
          accept={PINT_PHOTO_ACCEPT}
          aria-label={`Optional pint photo for ${venueName}`}
          onChange={(event) => {
            onPintPhotoChosen(event.target.files?.[0]);
          }}
        />
        <button
          type="button"
          className="vpsubPhotoBtn"
          onClick={() => pintPhotoInputRef.current?.click()}
          disabled={submitting || missionPending}
        >
          <Camera size={15} aria-hidden="true" />
          {pintPhoto ? "Change photo" : "Add photo (optional)"}
        </button>
        {pintPhoto ? (
          <button
            type="button"
            className="vpsubPhotoClear"
            onClick={clearPintPhoto}
            disabled={submitting || missionPending}
          >
            Remove photo
          </button>
        ) : null}
      </div>

      {visibleError ? (
        <p id="vpsubError" className="vpsubError" role="alert">
          {visibleError}
        </p>
      ) : null}

      {logged?.category === category && (logged.missionReceipt || stamped) ? (
        // The receipt. Same figure and day label the venue card now carries -
        // one vocabulary, one moment. What it must NOT do is overclaim: a lone
        // report does not set the pin's price, and saying "on the map" for it
        // would be the exact dishonesty the trust gate exists to fix.
        //
        // Three honest standings, in descending reach:
        //   painting  - this figure IS the pin's price ("On the map");
        //   marked    - the pin now wears the provisional dot, price unchanged;
        //   page only - a non-pint drink, or an aged-out figure: no map at all.
        // A mission receipt is the write-back standing, never the client reason.
        <div className="vpsubStampBlock">
          <p className="vpsubStamp" role="status">
            <Check size={14} aria-hidden="true" className="vpsubStampTick" />
            {logged.missionReceipt ? (
              <strong className="vpsubStampPrice">{logged.missionReceipt.line}</strong>
            ) : stamped ? (
              <>
                <strong className="vpsubStampPrice">{formatPrice(stamped.priceGbp)}</strong>
                <span className="vpsubStampMeta">
                  {stampStanding} · {formatPriceDay(stamped.submittedAt)}
                </span>
              </>
            ) : null}
          </p>
          <PriceContributionImpact attribution={logged.attribution} />
          {/* Close the loop in-session: the mark the map just gained, named and
              coloured exactly as the map draws it, so the submitter can look up
              and find their own dot rather than take our word for it. */}
          {!logged.missionReceipt && markedProvisionally ? (
            <p className="vpsubStampHint">
              <i className="vpsubStampDot" aria-hidden="true" />
              Its pin now carries this dot.{" "}
              {mapReach === "paint"
                ? "A second independent drinker reporting a similar price can set the pin’s colour."
                : "A second independent drinker reporting a similar price can confirm the figure here."}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="vpsubNote">
          Your price shows on this pub&rsquo;s page straight away, dated and
          badged as community. It never replaces the price on record.{" "}
          {communityReachNote(category, mapReach)} Up to £
          {COMMUNITY_PRICE_MAX_GBP} a drink. It counts under your public handle
          on the contributor record.
        </p>
      )}
      {contributionGateDialog}
    </section>
  );
}
