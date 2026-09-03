import { describe, expect, it } from "vitest";

import {
  acceptedProposalFactSource,
  buildFactClaims,
  FACT_AUTHORITY_RANK,
  resolveClaims,
  type FactSource,
} from "@/lib/factClaims";
import {
  buildPriceClaims,
  conflictPrices,
  priceFieldId,
  priceStorySignals,
  resolvePrice,
  PRICE_CONFLICT_WINDOW_MS,
} from "@/lib/priceFactClaims";
import { priceConfidence, FRESH_WITHIN_DAYS } from "@/lib/priceConfidence";

const NOW = Date.UTC(2026, 6, 20, 20, 0, 0);
const DAY = 86_400_000;
const FIELD = "price:venue-1:pint";

// Build one source at a value, defaulting the axes so a test can vary exactly
// the one dimension it is asserting about.
function src(value: number, over: Partial<FactSource<number>> = {}): FactSource<number> {
  return {
    authority: "community",
    value,
    observedAt: NOW,
    publisher: `pub-${Math.random()}`,
    confidence: 0.5,
    ...over,
  };
}

// A single-source claim for one value, so resolution ordering can be tested one
// axis at a time.
function claim(value: number, over: Partial<FactSource<number>> = {}) {
  return buildFactClaims(FIELD, [src(value, over)])[0];
}

describe("resolution ordering — authority > freshness > corroboration > confidence", () => {
  it("authority wins even against a fresher, corroborated, higher-confidence rival", () => {
    // Losing rival is better on EVERY lower axis; authority alone must decide.
    const official = claim(6.4, { authority: "official", observedAt: NOW - 300 * DAY, confidence: 0.1 });
    const community = buildFactClaims(FIELD, [
      src(6.9, { authority: "community", observedAt: NOW, publisher: "a", confidence: 0.99 }),
      src(6.9, { authority: "scraped", observedAt: NOW, publisher: "b", confidence: 0.99 }),
    ])[0];
    expect(community.verification).toBe("corroborated"); // rival is genuinely stronger below authority
    const res = resolveClaims([community, official], { now: NOW, conflictWindowMs: 30 * DAY });
    expect(res?.winner.value).toBe(6.4);
    expect(res?.winner.authority).toBe("official");
  });

  it("at equal authority, freshness wins over corroboration and confidence", () => {
    const fresh = claim(6.5, { authority: "scraped", observedAt: NOW, confidence: 0.1 });
    const stale = buildFactClaims(FIELD, [
      src(6.6, { authority: "scraped", observedAt: NOW - 5 * DAY, publisher: "a", confidence: 0.99 }),
      src(6.6, { authority: "community", observedAt: NOW - 5 * DAY, publisher: "b", confidence: 0.99 }),
    ])[0];
    expect(stale.verification).toBe("corroborated");
    const res = resolveClaims([stale, fresh], { now: NOW, conflictWindowMs: 30 * DAY });
    expect(res?.winner.value).toBe(6.5);
  });

  it("at equal authority and freshness, corroboration wins over confidence", () => {
    const corroborated = buildFactClaims(FIELD, [
      src(6.7, { authority: "scraped", observedAt: NOW, publisher: "a", confidence: 0.2 }),
      src(6.7, { authority: "community", observedAt: NOW, publisher: "b", confidence: 0.2 }),
    ])[0];
    const lone = claim(6.8, { authority: "scraped", observedAt: NOW, confidence: 0.99 });
    expect(corroborated.verification).toBe("corroborated");
    expect(lone.verification).toBe("single_source");
    const res = resolveClaims([lone, corroborated], { now: NOW, conflictWindowMs: 30 * DAY });
    expect(res?.winner.value).toBe(6.7);
  });

  it("at equal authority, freshness and corroboration, confidence breaks the tie", () => {
    const strong = claim(6.1, { authority: "scraped", observedAt: NOW, confidence: 0.9 });
    const weak = claim(6.2, { authority: "scraped", observedAt: NOW, confidence: 0.3 });
    const res = resolveClaims([weak, strong], { now: NOW, conflictWindowMs: 30 * DAY });
    expect(res?.winner.value).toBe(6.1);
  });

  it("manual_review outranks single_source but not corroborated on the corroboration axis", () => {
    const reviewed = claim(5.0, { authority: "scraped", observedAt: NOW, confidence: 0.5, reviewed: true });
    const lone = claim(5.1, { authority: "scraped", observedAt: NOW, confidence: 0.5 });
    expect(reviewed.verification).toBe("manual_review");
    expect(resolveClaims([lone, reviewed], { now: NOW, conflictWindowMs: 30 * DAY })?.winner.value).toBe(5.0);

    const corroborated = buildFactClaims(FIELD, [
      src(5.2, { authority: "scraped", observedAt: NOW, publisher: "a" }),
      src(5.2, { authority: "community", observedAt: NOW, publisher: "b" }),
    ])[0];
    expect(resolveClaims([reviewed, corroborated], { now: NOW, conflictWindowMs: 30 * DAY })?.winner.value).toBe(5.2);
  });
});

describe("conflict-window behaviour", () => {
  it("flags a live conflict when a disagreeing claim is within the window", () => {
    const baseline = claim(6.4, { authority: "scraped", observedAt: 0, publisher: "dataset" });
    const fresh = claim(6.9, { authority: "community", observedAt: NOW - 2 * DAY });
    const res = resolveClaims([baseline, fresh], { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.winner.value).toBe(6.4); // scraped serves by authority
    expect(res?.conflict).not.toBeNull();
    expect(res?.conflict?.values).toEqual([6.4, 6.9]); // winner first, disagreeing exposed
  });

  it("does NOT flag a conflict when the disagreeing claim has aged past the window", () => {
    const baseline = claim(6.4, { authority: "scraped", observedAt: 0, publisher: "dataset" });
    const stale = claim(6.9, { authority: "community", observedAt: NOW - 40 * DAY });
    const res = resolveClaims([baseline, stale], { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.winner.value).toBe(6.4);
    expect(res?.conflict).toBeNull(); // stale disagreement is history, resolves cleanly
  });

  it("the winner is always live even when itself undated", () => {
    const baseline = claim(6.4, { authority: "scraped", observedAt: 0, publisher: "dataset" });
    const res = resolveClaims([baseline], { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.conflict).toBeNull();
    expect(res?.winner.value).toBe(6.4);
  });

  it("returns null for an empty claim set", () => {
    expect(resolveClaims([], { now: NOW, conflictWindowMs: 14 * DAY })).toBeNull();
  });

  it("agreeing recent claims are not a conflict", () => {
    const a = claim(6.5, { authority: "scraped", observedAt: NOW, publisher: "dataset" });
    const b = claim(6.5, { authority: "community", observedAt: NOW });
    const res = resolveClaims([a, b], { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.conflict).toBeNull();
  });
});

describe("vouch-upgrade path — a community vouch on a scraped price corroborates it", () => {
  it("scraped single_source becomes corroborated once a community vouch lands on the same value", () => {
    const before = buildPriceClaims(FIELD, [
      { gbp: 6.4, authority: "scraped", observedAt: 0, publisher: "dataset" },
    ]);
    expect(before[0].verification).toBe("single_source");

    const after = buildPriceClaims(FIELD, [
      { gbp: 6.4, authority: "scraped", observedAt: 0, publisher: "dataset" },
      { gbp: 6.4, authority: "community", observedAt: NOW, publisher: "price-confirm" },
    ]);
    expect(after).toHaveLength(1); // same value → one claim
    expect(after[0].verification).toBe("corroborated");
  });

  it("priceStorySignals upgrades a vouched scraped baseline (no separate now price)", () => {
    const signals = priceStorySignals({
      baselineGbp: 6.4,
      nowGbp: null,
      confirm: { confirms: 3, lastConfirmedAt: NOW - DAY, recentConfirms: 2 },
      confirmTargetGbp: 6.4,
    });
    const claims = buildPriceClaims(priceFieldId("venue-1"), signals);
    expect(claims).toHaveLength(1);
    expect(claims[0].verification).toBe("corroborated");
    // No competing value → no conflict.
    expect(conflictPrices(resolvePrice(priceFieldId("venue-1"), signals, { now: NOW }))).toEqual([]);
  });

  it("two vouches from the SAME publisher do not fake corroboration", () => {
    const claims = buildPriceClaims(FIELD, [
      { gbp: 6.4, authority: "community", observedAt: NOW, publisher: "price-confirm" },
      { gbp: 6.4, authority: "community", observedAt: NOW, publisher: "price-confirm" },
    ]);
    expect(claims[0].verification).toBe("single_source");
  });
});

describe("honest-conflict render inputs — scrape 6.40 vs fresh vouch 6.90", () => {
  it("priceStorySignals + resolvePrice surfaces both prices ascending", () => {
    const signals = priceStorySignals({
      baselineGbp: 6.4,
      nowGbp: 6.9,
      confirm: { confirms: 2, lastConfirmedAt: NOW - DAY, recentConfirms: 2 },
      confirmTargetGbp: 6.9, // the tally is keyed to the community "now" price
    });
    const res = resolvePrice(priceFieldId("venue-1"), signals, { now: NOW });
    expect(res?.winner.value).toBe(6.4); // scraped serves by authority
    expect(conflictPrices(res)).toEqual([6.4, 6.9]); // both exposed, never hidden
  });

  it("an unvouched, undated community now-price cannot fake liveness", () => {
    // Without a confirm timestamp we cannot prove the drop is fresh → no live
    // conflict is asserted (honest: absence of proof is not a conflict).
    const signals = priceStorySignals({
      baselineGbp: 6.4,
      nowGbp: 6.9,
      confirm: null,
      confirmTargetGbp: 6.9,
    });
    expect(conflictPrices(resolvePrice(priceFieldId("venue-1"), signals, { now: NOW }))).toEqual([]);
  });

  it("the conflict window matches priceConfidence's fresh fortnight", () => {
    expect(PRICE_CONFLICT_WINDOW_MS).toBe(FRESH_WITHIN_DAYS * DAY);
  });
});

describe("adapter API stability — priceConfidence public contract is unchanged", () => {
  it("priceConfidence still returns { state, label } and reads the same shape", () => {
    const out = priceConfidence(
      { confirms: 2, lastConfirmedAt: NOW - DAY, recentConfirms: 2 },
      NOW,
    );
    expect(out).toEqual({ state: "fresh", label: "×2 this week" });
  });

  it("a price with no confirm history still yields no confidence line", () => {
    const out = priceConfidence({ confirms: 0, lastConfirmedAt: null }, NOW);
    expect(out.state).toBe("stale");
    expect(out.label).toBe("worth a fresh look");
  });

  it("pennies equality collapses 6.4 and 6.40 to one claim", () => {
    const claims = buildPriceClaims(FIELD, [
      { gbp: 6.4, authority: "scraped", observedAt: 0 },
      { gbp: 6.40, authority: "community", observedAt: NOW, publisher: "x" },
    ]);
    expect(claims).toHaveLength(1);
  });
});

describe("generality — the model serves a non-price fact (hours)", () => {
  it("resolves an hours string fact and exposes a live disagreement", () => {
    const official: FactSource<string> = {
      authority: "official",
      value: "17:00-23:00",
      observedAt: 0,
      publisher: "venue",
    };
    const community: FactSource<string> = {
      authority: "community",
      value: "17:00-00:00",
      observedAt: NOW - DAY,
      publisher: "regular",
    };
    const claims = buildFactClaims("hours:venue-1", [official, community]);
    const res = resolveClaims(claims, { now: NOW, conflictWindowMs: 14 * DAY });
    expect(res?.winner.value).toBe("17:00-23:00"); // official serves
    expect(res?.conflict?.values).toEqual(["17:00-23:00", "17:00-00:00"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Operator rail bridge (Wayfinder 3.5): an accepted operator proposal folds in as
// an `operator` FactSource — additive, attributed, and RANK 0 so it can never
// silently outrank the observed corpus (renamed from the reserved operator-future
// slot #483, semantics unchanged).
// ─────────────────────────────────────────────────────────────────────────────
describe("acceptedProposalFactSource (operator materialisation)", () => {
  it("builds a reviewed operator source at rank 0", () => {
    const src = acceptedProposalFactSource({
      value: "Open till 1am",
      acceptedAt: NOW,
      publisher: "operator:acct-1",
    });
    expect(src.authority).toBe("operator");
    expect(src.value).toBe("Open till 1am");
    expect(src.observedAt).toBe(NOW);
    expect(src.reviewed).toBe(true);
    expect(FACT_AUTHORITY_RANK.operator).toBe(0);
  });

  it("never outranks an observed present fact — surfaces as a conflict instead", () => {
    const scraped: FactSource<string> = {
      authority: "scraped",
      value: "17:00-23:00",
      observedAt: NOW - DAY,
      publisher: "dataset",
    };
    const operator = acceptedProposalFactSource({
      value: "17:00-01:00",
      acceptedAt: NOW,
      publisher: "operator:acct-1",
    });
    const claims = buildFactClaims("hours:venue-9", [scraped, operator]);
    const res = resolveClaims(claims, { now: NOW, conflictWindowMs: 14 * DAY });
    // Scraped (rank 2) still serves; the fresher operator claim is EXPOSED as a
    // live conflict, never a silent overwrite.
    expect(res?.winner.value).toBe("17:00-23:00");
    expect(res?.conflict?.values).toContain("17:00-01:00");
  });
});
