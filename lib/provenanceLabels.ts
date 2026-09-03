// Single vocabulary for pint-drop provenance chips (QA 2026-07-07, P4).
// Display labels ONLY — provenance values themselves never change here.
//
// The two-value mental model a reader must be able to build:
//   - "Demo"    → seeded example content (dashed/muted chip idiom, per
//                 docs/DESIGN_SYSTEM.md and drinkMenu.css `.drinkProvChip.demo`)
//   - "Sourced" → a real, attributable source (never collapsed into Demo —
//                 provenance never flattens)
// Contributor/Anecdote sit alongside as real community provenance.

import type { Provenance } from "@/lib/curation";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
  demo: "Demo",
};
