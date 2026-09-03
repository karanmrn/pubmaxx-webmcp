// Sponsorship rails (wayfinder 3.6). NO sponsorship exists yet; this module is
// the type + helper rail that the FIRST paid placement must be built on, so the
// separation invariants are law before any deal arrives. See
// docs/SPONSORSHIP_POLICY.md for the rules these types encode.
//
// Deliberate structural walls:
//   1. This module imports NOTHING from any ranking seam (lib/forYou.ts,
//      lib/concierge/rank.ts, lib/nearMeAnswer.ts). The fence in
//      __tests__/sponsorshipFence.test.ts enforces the reverse edge too:
//      no ranker may import this file or name a sponsorship token.
//   2. This module has NO knowledge of Provenance (lib/curation.ts). A
//      sponsored placement therefore cannot carry, set, or overwrite a
//      provenance value; the wall is structural, not just documented.
//   3. Disclosure is required by the type system: a SponsoredPlacement whose
//      disclosureLabel is anything other than the constant below does not
//      typecheck, so no placement can render undisclosed.

// The single disclosure chip. Every sponsored surface renders exactly this
// text, and it is distinct from every Provenance chip in lib/provenanceLabels.ts
// (Sourced / Contributor / Anecdote / Demo). A reader can never mistake a paid
// placement for organic community data.
export const SPONSORED_DISCLOSURE_LABEL = "Sponsored" as const;
export type SponsoredDisclosureLabel = typeof SPONSORED_DISCLOSURE_LABEL;

// Sponsored content lives ONLY in isolated slots whose id carries this prefix.
// An organic feed/rank id can never collide with a sponsored slot id, and a
// grep for the prefix finds every paid slot in one pass.
export const SPONSORED_SLOT_PREFIX = "sponsored:" as const;
export type SponsoredSlotId = `${typeof SPONSORED_SLOT_PREFIX}${string}`;

export function sponsoredSlotId(key: string): SponsoredSlotId {
  return `${SPONSORED_SLOT_PREFIX}${key}`;
}

export function isSponsoredSlotId(id: string): id is SponsoredSlotId {
  return id.startsWith(SPONSORED_SLOT_PREFIX);
}

// Affiliate/outbound link rules. Every sponsored link is rel-marked so search
// engines and readers both know it is paid, and the disclosure label must sit
// adjacent (enforced at render time; see the policy doc). The rel string is a
// constant so a placement cannot ship a weaker rel.
export const SPONSORED_LINK_REL = "sponsored nofollow noopener" as const;
export type SponsoredLinkRel = typeof SPONSORED_LINK_REL;

export type SponsoredLink = {
  href: string;
  rel: SponsoredLinkRel;
};

export function sponsoredLink(href: string): SponsoredLink {
  return { href, rel: SPONSORED_LINK_REL };
}

// Owner review stamp. Every sponsor surface is approved by the owner before it
// renders; the stamp travels with the placement so the approval is auditable at
// the point of display, not buried in a config elsewhere.
export type SponsorReviewStamp = {
  // Owner identity that approved this exact surface.
  approvedBy: string;
  // ISO-8601 timestamp of approval.
  approvedAt: string;
  // The named surface this approval covers (e.g. "tonight-feed-slot").
  surface: string;
};

// A single paid placement. The type encodes the disclosure contract:
//   - disclosureLabel is required and can only be the constant, so a placement
//     can never render without its "Sponsored" chip.
//   - slotId is a branded, prefixed id, so the placement occupies an isolated
//     slot and is never interleaved into an organic list unlabelled.
//   - there is NO provenance field, by design: a placement cannot supply or
//     overwrite the provenance of any organic item.
//   - review is required, so no surface renders without owner approval.
export type SponsoredPlacement = {
  slotId: SponsoredSlotId;
  disclosureLabel: SponsoredDisclosureLabel;
  // Sponsor display name, shown ADJACENT to the label, never in place of it.
  sponsorName: string;
  // Optional outbound affiliate link, rel-marked via sponsoredLink().
  link?: SponsoredLink;
  review: SponsorReviewStamp;
};

// The rail future work must use to construct a placement. Callers supply the
// sponsor-specific fields; the disclosure label is stamped here so it is never
// forgotten, and the slot id is branded so it is never a bare string.
export function createSponsoredPlacement(input: {
  slotKey: string;
  sponsorName: string;
  review: SponsorReviewStamp;
  link?: SponsoredLink;
}): SponsoredPlacement {
  return {
    slotId: sponsoredSlotId(input.slotKey),
    disclosureLabel: SPONSORED_DISCLOSURE_LABEL,
    sponsorName: input.sponsorName,
    ...(input.link ? { link: input.link } : {}),
    review: input.review,
  };
}

// A placement is disclosable only when its label is the exact constant. Render
// code should refuse to paint any placement this returns false for.
export function isDisclosed(placement: SponsoredPlacement): boolean {
  return placement.disclosureLabel === SPONSORED_DISCLOSURE_LABEL;
}
