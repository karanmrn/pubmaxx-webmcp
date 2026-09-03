"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import { priceConfidence } from "@/lib/priceConfidence";
import {
  conflictPrices,
  priceFieldId,
  priceStorySignals,
  resolvePrice,
} from "@/lib/priceFactClaims";
import { formatPrice, type Venue } from "@/lib/venues";
import type { Provenance } from "@/lib/curation";
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import {
  computeVenuePriceStory,
  type VenuePriceStamp,
  type VenuePriceStoryDrop,
} from "@/lib/thenVsNow";

import "./venuePriceStory.css";

// The Golden Thread on the venue surface: a pub's own price story — the baseline
// price on record, the freshest community-logged price, the delta between them,
// and (when the community has passed down a dated memory) an inflation line
// "a pint here was £X in YYYY — £Y in today's money". Purely presentational and
// prop-driven: VenueInspector computes nothing; it hands over the venue + its
// drops and this block resolves the whole story via computeVenuePriceStory.
//
// Provenance is NEVER flattened: every figure carries its own badge (sourced /
// contributor / anecdote / demo) so a seeded demo price can never masquerade as
// real community data. When the venue has no price story at all, an honest
// empty state renders instead of an empty frame.

function ProvChip({ provenance }: { provenance: Provenance }) {
  return <span className={`provChip ${provenance}`}>{PROVENANCE_LABEL[provenance]}</span>;
}

// "£6.40 and £6.90" / "£6.40, £6.90 and £7.10" — plain register, no dashes.
function formatPriceList(gbps: number[]): string {
  const parts = gbps.map((gbp) => formatPrice(gbp));
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function direction(deltaGbp: number): "up" | "down" | "flat" {
  const pennies = Math.round(deltaGbp * 100);
  if (pennies > 0) return "up";
  if (pennies < 0) return "down";
  return "flat";
}

// The two price values are also drawn as proportional bars — the longer bar is
// the dearer pint, so the movement reads at a glance before any number is parsed.
function StoryBars({ baseline, now }: { baseline: VenuePriceStamp; now: VenuePriceStamp }) {
  const max = Math.max(baseline.gbp, now.gbp, 0.01);
  const thenPct = Math.max(6, Math.round((baseline.gbp / max) * 100));
  const nowPct = Math.max(6, Math.round((now.gbp / max) * 100));
  return (
    <div className="vpsBars" aria-hidden="true">
      <div className="vpsBarRow">
        <span className="vpsBarLabel">Baseline</span>
        <span className="vpsBarTrack">
          <span className="vpsBarFill vpsBarFillThen" style={{ width: `${thenPct}%` }} />
        </span>
        <span className="vpsBarValue">{formatPrice(baseline.gbp)}</span>
      </div>
      <div className="vpsBarRow">
        <span className="vpsBarLabel">Now</span>
        <span className="vpsBarTrack">
          <span className="vpsBarFill vpsBarFillNow" style={{ width: `${nowPct}%` }} />
        </span>
        <span className="vpsBarValue">{formatPrice(now.gbp)}</span>
      </div>
    </div>
  );
}

// A hand-drawn check — an inline SVG (not a lucide glyph) so the confirmed state
// can stroke-draw the tick on: the single path is animated via stroke-dashoffset
// in venuePriceStory.css, gated behind prefers-reduced-motion.
function ConfirmTick() {
  return (
    <svg
      className="vpsConfirmTick"
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path className="vpsConfirmTickPath" d="M4 10.6 L8.4 15 L16 5.4" />
    </svg>
  );
}

// Reader-visible tally: fetch the community confirm count on mount so social
// proof shows BEFORE anyone taps — a vouched price should look vouched to every
// visitor, not only to the person who tapped. Fail-soft: any error yields null
// and the chip renders exactly as it did before this hook existed.
type ConfirmTally = { confirms: number; lastConfirmedAt: number | null; recentConfirms: number };
type ConfirmRead = {
  tally: ConfirmTally;
  confidence: ReturnType<typeof priceConfidence> | null;
  // Distinct GBP values in a live price conflict (ascending), or [] when the
  // price resolves cleanly. Resolved through the generic fact-claim model.
  conflictGbps: number[];
};

// Confidence AND the price-conflict resolution are derived INSIDE the effect
// (with the wall clock read there, not in render) so the component stays pure for
// the React Compiler — the clock is captured once per fetch, which is exactly the
// freshness the resolution reasons about.
function usePriceConfirmTally(
  venueId: string,
  confirmTargetGbp: number,
  baselineGbp: number | null,
  nowGbp: number | null,
): ConfirmRead | null {
  const requestKey = `${venueId}:${confirmTargetGbp}:${baselineGbp ?? ""}:${nowGbp ?? ""}`;
  const [result, setResult] = useState<{ key: string; read: ConfirmRead } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/price-confirm?venueId=${encodeURIComponent(venueId)}&priceGbp=${confirmTargetGbp}`,
        );
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const data = (await res.json()) as Partial<ConfirmTally>;
        if (cancelled) return;
        const tally: ConfirmTally = {
          confirms: typeof data.confirms === "number" ? data.confirms : 0,
          lastConfirmedAt:
            typeof data.lastConfirmedAt === "number" ? data.lastConfirmedAt : null,
          recentConfirms: typeof data.recentConfirms === "number" ? data.recentConfirms : 0,
        };
        // Wire baseline + community "now" + the vouch tally through the
        // fact-claim model. A live conflict (on-record price vs a freshly-vouched
        // different price) is exposed plainly rather than silently picked.
        const resolution = resolvePrice(
          priceFieldId(venueId),
          priceStorySignals({
            baselineGbp,
            nowGbp,
            confirm: tally,
            confirmTargetGbp,
          }),
          { now: Date.now() },
        );
        setResult({
          key: requestKey,
          read: {
            tally,
            confidence: tally.confirms > 0 ? priceConfidence(tally, Date.now()) : null,
            conflictGbps: conflictPrices(resolution),
          },
        });
      } catch {
        // Fail-soft: no tally, chip behaves as before.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, confirmTargetGbp, baselineGbp, nowGbp, requestKey]);
  return result?.key === requestKey ? result.read : null;
}

// One-tap "still accurate?" micro-contribution. Tapping vouches the displayed
// price is still right and flips to an optimistic confirmed state instantly (a
// satisfying scale-in + tick draw); the POST to /api/price-confirm is fail-soft,
// so the confirmed state stands even if the backend is unavailable. This is a
// lightweight community signal, never a new price — the store only ever counts
// distinct confirmers of an already-shown figure. Keyed by venue+price by the
// caller so it resets cleanly when the inspected pub changes.
function PriceConfirmChip({
  venueId,
  priceGbp,
  priceLabel,
  confidence,
  onPriceChanged,
}: {
  venueId: string;
  priceGbp: number;
  priceLabel: string;
  confidence: { state: string; label: string | null } | null;
  onPriceChanged?: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [confirms, setConfirms] = useState<number | null>(null);
  const [error, setError] = useState("");

  const confirm = useCallback(async () => {
    if (confirmed) return; // a vouch is one-way; re-taps are inert (idempotent).
    // Optimistic: flip to confirmed before the network round-trip so the tap
    // feels instant. The real distinct-confirmer count backfills when it lands.
    setConfirmed(true);
    setError("");
    try {
      const res = await fetch("/api/price-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, priceGbp }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setConfirmed(false);
        setError(
          offlineOrMessage(errorMessageFrom(body, "Could not confirm that price. Try again."))
        );
        return;
      }
      const data = body as { confirms?: number } | null;
      if (typeof data?.confirms === "number") setConfirms(data.confirms);
    } catch {
      setConfirmed(false);
      setError(
        offlineOrMessage("Could not confirm that price. Try again.")
      );
    }
  }, [confirmed, venueId, priceGbp]);

  // Post-tap the server tally wins; pre-tap the reader-visible confidence line
  // (from the mounted GET) speaks — "×3 this week" / "vouched recently" — so
  // social proof isn't gated behind contributing.
  const countLabel =
    confirms !== null ? `${confirms} ${confirms === 1 ? "confirm" : "confirms"}` : "";

  // One persistent <button> across idle → confirmed so keyboard focus is never
  // dropped (a node swap would send focus to <body>). Confirmed is announced via
  // the adjacent sr-only live region.
  return (
    <div className="vpsConfirm">
      <button
        type="button"
        className={confirmed ? "vpsConfirmBtn vpsConfirmDone" : "vpsConfirmBtn"}
        onClick={confirm}
        aria-pressed={confirmed}
        aria-label={
          confirmed
            ? `Confirmed a pint here is still ${priceLabel}`
            : `Confirm a pint here is still ${priceLabel}`
        }
      >
        <ConfirmTick />
        <span className="vpsConfirmText">
          {confirmed ? "Confirmed just now" : `Still ${priceLabel}?`}
          {confirmed && countLabel ? <span className="vpsConfirmCount"> · {countLabel}</span> : null}
          {!confirmed && confidence?.label ? (
            <span className="vpsConfirmCount"> · {confidence.label}</span>
          ) : null}
        </span>
      </button>
      {onPriceChanged ? (
        <button
          type="button"
          className="vpsChangedBtn"
          onClick={onPriceChanged}
          aria-label={`The price has changed. Log the new price for this pub`}
        >
          It&rsquo;s changed
        </button>
      ) : null}
      {confirmed ? (
        <span className="srOnly" role="status">
          Confirmed{countLabel ? ` · ${countLabel}` : ""}.
        </span>
      ) : null}
      {error ? <span role="status">{error}</span> : null}
    </div>
  );
}

type VenuePriceStoryProps = {
  venue: Venue;
  drops: VenuePriceStoryDrop[];
  /** "It's changed" routes here — the correction IS a new drop (opens the composer). */
  onPriceChanged?: () => void;
};

export default function VenuePriceStory({ venue, drops, onPriceChanged }: VenuePriceStoryProps) {
  const story = computeVenuePriceStory(venue, drops);
  // Hooks run unconditionally (before the empty-state return): the freshest
  // actionable price to vouch for is the community "now" when present, else the
  // baseline on record. A zero-price sentinel keeps the hook honest when the
  // story is empty — the fetch is skipped server-side by validation and the
  // tally stays null.
  const confirmTarget = story.now ?? story.baseline;
  const read = usePriceConfirmTally(
    venue.id,
    confirmTarget ? confirmTarget.gbp : 0,
    story.baseline ? story.baseline.gbp : null,
    story.now ? story.now.gbp : null,
  );
  const confidence = confirmTarget ? (read?.confidence ?? null) : null;
  const conflictGbps = read?.conflictGbps ?? [];

  if (story.isEmpty) {
    return (
      <section className="venuePriceStory" aria-labelledby="vpsTitle">
        <div className="inspectorTitle">
          <TrendingUp size={16} />
          <span id="vpsTitle">The Golden Thread</span>
        </div>
        <p className="description muted">
          No price story on record for {venue.name}{" "}yet. Log tonight&rsquo;s price, or pass down a
          dated memory (&ldquo;a pint here in 1985&hellip;&rdquo;), and this pub&rsquo;s thread
          starts here.
        </p>
      </section>
    );
  }

  const { baseline, now, deltaGbp, pct, inflation } = story;
  // The freshest actionable price to vouch for: the community "now" price when
  // present, otherwise the baseline on record.

  const dir = deltaGbp !== null ? direction(deltaGbp) : "flat";
  const DirIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  return (
    <section className="venuePriceStory" aria-labelledby="vpsTitle">
      <div className="inspectorTitle">
        <TrendingUp size={16} />
        <span id="vpsTitle">The Golden Thread</span>
      </div>

      {/* Then vs Now: the baseline on record against the freshest community
          price. Data prices use stable badges; provenance keeps its own chip. */}
      {baseline || now ? (
        <div className="vpsPricePair">
          {baseline ? (
            <div className="vpsPriceGroup">
              <span className="vpsPriceLabel">{baseline.label}</span>
              <PriceBadge variant="baseline" className="vpsPriceValue vpsPriceThen">
                {formatPrice(baseline.gbp)}
              </PriceBadge>
              <ProvChip provenance={baseline.provenance} />
            </div>
          ) : null}
          {baseline && now ? (
            <span className="vpsArrow" aria-hidden="true">
              →
            </span>
          ) : null}
          {now ? (
            <div className="vpsPriceGroup">
              <span className="vpsPriceLabel">{now.label}</span>
              <PriceBadge
                variant={dir === "up" ? "increase" : "current"}
                className={
                  confidence
                    ? `vpsPriceValue vpsPriceNow vpsConfidence-${confidence.state}`
                    : "vpsPriceValue vpsPriceNow"
                }
              >
                {formatPrice(now.gbp)}
              </PriceBadge>
              <ProvChip provenance={now.provenance} />
            </div>
          ) : null}
        </div>
      ) : null}

      {baseline && now ? <StoryBars baseline={baseline} now={now} /> : null}

      {deltaGbp !== null && pct !== null ? (
        <p className={`vpsDelta vpsDelta-${dir}`}>
          <DirIcon size={15} aria-hidden="true" />
          <span aria-hidden="true">
            {dir === "flat"
              ? "No change from the earlier price"
              : `${dir === "up" ? "+" : "−"}${formatPrice(Math.abs(deltaGbp))} (${Math.abs(
                  pct,
                ).toFixed(0)}%) vs earlier price`}
          </span>
          <span className="srOnly">
            {dir === "flat"
              ? `The community price matches the earlier ${formatPrice(baseline!.gbp)} price on record.`
              : `${dir === "up" ? "Up" : "Down"} ${formatPrice(Math.abs(deltaGbp))} (${Math.abs(
                  pct,
                ).toFixed(0)}%) from the ${formatPrice(
                  baseline!.gbp,
                )} earlier price, community-reported.`}
          </span>
        </p>
      ) : null}

      {/* Honest conflict: when the on-record price and a freshly-vouched
          community price disagree, both are shown plainly rather than silently
          serving one. Resolved through the generic fact-claim model. */}
      {conflictGbps.length >= 2 ? (
        <p className="vpsConflict" role="note">
          Reported at {formatPriceList(conflictGbps)} recently. Both stand until
          the next confirm settles it.
        </p>
      ) : null}

      {/* One-tap "still accurate?" community signal for the freshest actionable
          price (the community "now" price when present, else the baseline on
          record). Keyed by venue+price so the confirmed state never leaks across
          pubs (the component instance persists between selections). */}
      {confirmTarget ? (
        <PriceConfirmChip
          confidence={confidence}
          onPriceChanged={onPriceChanged}
          key={`${venue.id}:${Math.round(confirmTarget.gbp * 100)}`}
          venueId={venue.id}
          priceGbp={confirmTarget.gbp}
          priceLabel={formatPrice(confirmTarget.gbp)}
        />
      ) : null}

      {/* The inflation line — a dated, priced memory revalued into today's
          money. Provenance-badged: an anecdote is never mistaken for a fact. */}
      {inflation ? (
        <div className="vpsInflation">
          <p className="vpsInflationLine">
            A pint here was <strong>{formatPrice(inflation.thenGbp)}</strong> in{" "}
            <strong>{inflation.year}</strong>. That&rsquo;s{" "}
            <strong className="vpsToday">{formatPrice(inflation.todayGbp)}</strong> in{" "}
            {inflation.todayYear}&rsquo;s money.
          </p>
          <div className="vpsInflationMeta">
            <ProvChip provenance={inflation.provenance} />
            <span className="vpsInflationBy">passed down by {inflation.handle}</span>
          </div>
        </div>
      ) : null}

      <p className="vpsFootnote">
        Baseline = dataset price on record · Now = community-reported · inflation revalued via UK CPI
      </p>
    </section>
  );
}
