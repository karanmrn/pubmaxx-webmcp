import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Trusted-data fence (Wayfinder 3.5). An operator proposal is a REQUEST an admin
// reviews; it must NEVER be able to write a venue fact on its own. This is a
// source-reading fence (like opsFreeze's guard-containment fence): the pure
// proposal module and its store may not import ANY trusted venue-fact module. The
// ONLY bridge from a proposal to served evidence is the admin acceptance seam —
// the moderator ACCEPT branch of app/api/operator-proposals/route.ts, which alone
// reaches factClaims.acceptedProposalFactSource. If a future edit wires a fact
// store into the proposal layer, this fails.

const ROOT = process.cwd();

// The trusted venue-fact modules a proposal must never touch: the fact-resolution
// engine, the price adapter, and the durable stores holding observed venue data.
const FORBIDDEN_FACT_IMPORTS = [
  "@/lib/factClaims",
  "@/lib/priceFactClaims",
  "@/lib/pintDropsStore",
  "@/lib/visitReportsStore",
  "@/lib/ratingsStore",
  "@/lib/ledger",
  "@/lib/venues",
];

// The proposal layer that must stay inert with respect to trusted data.
const PROPOSAL_LAYER = ["lib/operatorProposals.ts", "lib/operatorProposalsStore.ts"];

// The single sanctioned bridge.
const ACCEPTANCE_SEAM = "app/api/operator-proposals/route.ts";

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("operator proposal trusted-data fence", () => {
  it("the proposal layer imports no venue-fact module", () => {
    for (const file of PROPOSAL_LAYER) {
      const src = source(file);
      for (const mod of FORBIDDEN_FACT_IMPORTS) {
        expect(src, `${file} must not import ${mod}`).not.toContain(`from "${mod}"`);
      }
    }
  });

  it("only the admin acceptance seam bridges to acceptedProposalFactSource", () => {
    // The route (the ACCEPT branch) is allowed — and required — to reach the
    // materialisation bridge. The proposal store/module must not.
    expect(source(ACCEPTANCE_SEAM)).toContain("acceptedProposalFactSource");
    for (const file of PROPOSAL_LAYER) {
      expect(source(file)).not.toContain("acceptedProposalFactSource");
    }
  });

  it("materialisation is authority `operator`, rank 0 — never an overwrite", () => {
    // factClaims keeps the operator authority at the BOTTOM of the rank so an
    // accepted proposal is additive evidence, exposed as a conflict, not a silent
    // overwrite of the observed corpus.
    const fc = source("lib/factClaims.ts");
    expect(fc).toContain("operator: 0");
  });
});
