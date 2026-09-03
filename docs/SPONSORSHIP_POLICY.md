# Sponsorship and Affiliate Separation Policy

Wayfinder ticket 3.6. This policy is written and fenced BEFORE any sponsorship
exists, so the invariants are law when the first deal arrives. No sponsored
content ships until a surface is built on the rails in `lib/sponsorship.ts` and
passes the fence in `__tests__/sponsorshipFence.test.ts`.

The governing rule, from the Sol roadmap: sponsored and affiliate content is
clearly separated and disclosed; payment never changes organic ranking,
eligibility, warnings, provenance, alternatives, or prices.

## The never-changes list

Payment, sponsorship, or an affiliate relationship never changes any of these:
organic ranking, eligibility, warnings, provenance, alternatives, or prices.

Concretely:

- Organic ranking. A sponsor cannot buy a higher position in any ranked list.
  The rankers (`lib/forYou.ts`, `lib/concierge/rank.ts`, `lib/nearMeAnswer.ts`)
  never read a sponsorship signal. Sponsored items live in isolated slots, not
  in the ranked sequence.
- Eligibility. Whether a venue can appear at all, be planned, or be recommended
  is decided by coverage and evidence, never by whether it pays.
- Warnings. Safety, last-train, accessibility, and freshness warnings render
  identically for paid and unpaid venues. A sponsor cannot suppress a warning.
- Provenance. The Sourced / Contributor / Anecdote / Demo chips
  (`lib/provenanceLabels.ts`) are never altered, hidden, or overwritten by a
  placement. The "Sponsored" chip is a separate, additional class, never a
  provenance value.
- Alternatives. Nearby and comparable-venue suggestions are computed without
  regard to sponsorship, so a sponsor is never listed in place of a better fit.
- Prices. Displayed prices come from the venue fact store only. A sponsor
  cannot raise, lower, hide, or annotate a price through the placement.

## Disclosure label spec

- The label text is exactly "Sponsored" (`SPONSORED_DISCLOSURE_LABEL`).
- The chip is visually distinct from every Provenance chip
  (Sourced / Contributor / Anecdote / Demo). It uses its own class, not the
  `.drinkProvChip` provenance idiom, so the two vocabularies never blur.
- The label is required on every sponsored surface. The type system enforces it:
  a `SponsoredPlacement` cannot be constructed without the label, and render
  code refuses any placement where `isDisclosed()` is false.
- The sponsor name renders adjacent to the label, never in place of it.

## Placement rules

- Sponsored content occupies isolated slots only, keyed by
  `SponsoredSlotId` (the `sponsored:` prefix). An organic id can never collide
  with a sponsored slot id.
- Never interleaved unlabelled. A placement is never dropped into an organic
  list without its "Sponsored" chip attached to that same item.
- Never above organic without the label. If a placement sits above organic
  results, the label is on it; an unlabelled item above organic is forbidden.
- Never inside warnings, provenance, or alternatives. Sponsored content never
  renders within a warning block, a provenance chip row, or an alternatives
  list. Those surfaces stay free of paid content entirely.

## Affiliate-link rules

- Every outbound sponsored or affiliate link carries
  `rel="sponsored nofollow noopener"` (`SPONSORED_LINK_REL`). The rel string is
  a constant so a placement cannot ship a weaker rel.
- The disclosure label sits adjacent to the link, so the paid nature is visible
  at the point of the click, not only elsewhere on the page.
- Affiliate links never replace an organic outbound link (for example a venue's
  own site or a booking link) that the user would otherwise get.

## Review gate

- The owner approves every sponsor surface before it renders. Approval is
  carried on the placement as a `SponsorReviewStamp` (who approved, when, and
  the exact named surface), so the approval is auditable at the point of
  display.
- A new sponsored surface is a new review. Reusing an approval from a different
  surface is not permitted; the stamp names the surface it covers.

## Enforcement

- `lib/sponsorship.ts` is the only rail for building a placement. It imports
  nothing from any ranker and has no knowledge of Provenance, so a placement is
  structurally unable to reach into ranking or overwrite provenance.
- `__tests__/sponsorshipFence.test.ts` reads source to keep it that way: no
  ranking module may import the sponsorship rail or name a sponsorship token,
  any component that references `SponsoredPlacement` must also reference the
  disclosure label export, and this policy doc must name the never-changes list
  verbatim.
