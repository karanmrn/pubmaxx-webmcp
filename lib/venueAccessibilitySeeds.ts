import { normaliseVenueName } from "@/lib/curation";
import type { VenueAccessibility } from "@/lib/venueAccessibility";

// Curated, provenance-stamped accessible-venue seed (PRD issue #28).
//
// HONESTY POLICY — this is the whole point of the feature:
//   * This is a COMMUNITY-CONTRIBUTED model. We do NOT invent accessibility
//     facts for the ~2,700-venue dataset. Only pubs whose access is PUBLICLY
//     DOCUMENTED (JD Wetherspoon venue pages, CAMRA & AccessAble access guides)
//     appear here, and only the fields those sources actually state.
//   * Absence of a field means UNKNOWN, never "no". A pub we haven't confirmed
//     step-free is simply excluded from the step-free filter — we never
//     optimistically claim access a source didn't state. Where a source states
//     a NEGATIVE (e.g. The Crosse Keys is NOT step-free at the door) we record
//     the honest `false` so it's excluded from the step-free filter AND never
//     shown as a step-free chip.
//   * Each entry carries a `sources` provenance comment (mirroring the sourced
//     curation entries in lib/curation.ts) so any claim is traceable. Every
//     field below is a fact its cited source states plainly — where a source is
//     silent on a facet, the field is OMITTED (unknown). We do not infer.
//
// Keyed by normalised pub name (the same normalisation lib/curation.ts uses).
// The keys are the EXACT names as they appear in
// public/data/pint_prices_app_dataset.json — verified against the dataset — so a
// seed lands on the real venue. Same-named pubs in the dataset are disambiguated
// by carrying distinct names (e.g. "The Ice Wharf - JD Wetherspoon"); where a
// bare name could collide we pin an optional `borough` guard.
//
// Sources captured July 2026:
//   - JDW app/table service (chain-wide): https://www.jdwetherspoon.com/order-and-pay-app/
//   - Ice Wharf: https://www.jdwetherspoon.com/pubs/the-ice-wharf-camden/
//   - The Coronet (AccessAble): https://www.accessable.co.uk/islington-council/access-guides/the-coronet
//   - The Crosse Keys (CAMRA): https://camra.org.uk/pubs/crosse-keys-london-156614
//   - The Brockley Barge (AccessAble): https://www.accessable.co.uk/london-borough-of-lewisham/access-guides/the-brockley-barge-jd-wetherspoon

type AccessibilitySeed = VenueAccessibility & {
  // Human hint of which pub this is (name + area) — pins the entry to a real
  // venue for reviewers; never rendered.
  venueHint: string;
  // Borough this seed applies to (matched case-insensitively against the
  // venue's primaryBorough). Absent = applies regardless of borough — used
  // when the dataset name is already unambiguous OR its borough field is
  // unreliable (some rows carry an empty/mis-tagged borough).
  borough?: string;
};

const accessibilitySeeds: Record<string, AccessibilitySeed> = {
  // The Ice Wharf, Camden (Wetherspoon). Official pub page lists "Step-free
  // access". Table service is the chain-wide JDW app policy. The accessible
  // toilet was only weakly sourced (reviews, not the official page) so it is
  // left UNKNOWN rather than claimed.
  "the ice wharf - jd wetherspoon": {
    venueHint: "The Ice Wharf — 28A/28B Jamestown Road, Camden NW1 (JDW)",
    stepFree: true,
    seatedService: true,
  },

  // The Coronet, Holloway/Islington (Wetherspoon). AccessAble guide: level
  // access to the venue and to a unisex accessible toilet via platform lift (no
  // RADAR key needed). Table service via the JDW app.
  "the coronet": {
    venueHint: "The Coronet — 338-346 Holloway Road, Islington N7 (JDW)",
    borough: "Islington",
    stepFree: true,
    accessibleToilet: true,
    seatedService: true,
  },

  // The Crosse Keys, City of London (Wetherspoon). HONEST NEGATIVE: CAMRA
  // documents three steps at the front entrance and four at the back — it is
  // NOT step-free at the door (a Euan's Guide reviewer couldn't get in), so
  // stepFree=false excludes it from the step-free filter. A fully accessible
  // ground-floor toilet IS documented, and table service is chain policy. Two
  // dataset rows share this name (one has an empty borough), so NO borough guard
  // — the fact is true for both rows of the same pub.
  "the crosse keys": {
    venueHint: "The Crosse Keys — 9 Gracechurch Street, City of London EC3V (JDW)",
    stepFree: false,
    accessibleToilet: true,
    seatedService: true,
  },

  // The Brockley Barge, Brockley/Lewisham (Wetherspoon). AccessAble documents a
  // rear accessible toilet (RADAR key from the bar). Step-free entry wasn't
  // clearly captured, so stepFree stays UNKNOWN. Table service is chain policy.
  // NB the dataset mis-tags this row's borough as "Havering" (address is SE4
  // Brockley) — so no borough guard; the name is unique enough to pin it.
  "the brockley barge - jd wetherspoon": {
    venueHint: "The Brockley Barge — 184 Brockley Road, Lewisham SE4 (JDW)",
    accessibleToilet: true,
    seatedService: true,
  },
};

// Look up documented accessibility for a venue by its pub name (and borough,
// only where a seed pins one to keep same-named pubs apart). Returns undefined
// for anything not in the curated seed — i.e. honestly UNKNOWN, the default for
// ~all of the dataset. The returned object is stripped of the reviewer-only
// `venueHint`/`borough` bookkeeping so callers see a clean VenueAccessibility.
export function getVenueAccessibility(
  pubName: string,
  primaryBorough: string,
): VenueAccessibility | undefined {
  const seed = accessibilitySeeds[normaliseVenueName(pubName)];
  if (!seed) return undefined;
  // Borough guard (only when the seed pins one): must match case-insensitively.
  if (
    seed.borough &&
    seed.borough.trim().toLowerCase() !== (primaryBorough ?? "").trim().toLowerCase()
  ) {
    return undefined;
  }
  const { stepFree, accessibleToilet, seatedService, quietHours } = seed;
  const facts: VenueAccessibility = {};
  if (stepFree !== undefined) facts.stepFree = stepFree;
  if (accessibleToilet !== undefined) facts.accessibleToilet = accessibleToilet;
  if (seatedService !== undefined) facts.seatedService = seatedService;
  if (quietHours !== undefined) facts.quietHours = quietHours;
  return Object.keys(facts).length > 0 ? facts : undefined;
}

// Count of seeded venues — for tests/telemetry that want to assert the seed
// isn't accidentally emptied or ballooned with unsourced entries.
export const ACCESSIBILITY_SEED_COUNT = Object.keys(accessibilitySeeds).length;
