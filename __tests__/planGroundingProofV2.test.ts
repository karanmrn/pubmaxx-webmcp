import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  PLAN_GROUNDING_PROOF_TTL_MS,
  mintPlanGroundingProof,
  mintPlanGroundingProofV2,
  readPlanGroundingClaimsV2,
  verifyAnchoredPlanGroundingProofV2,
  verifyPlanGroundingProof,
  type MintPlanGroundingProofV2Input,
} from "@/lib/planGrounding.server";

const ISSUED_AT = Date.parse("2026-07-24T12:00:00.000Z");
const OPERATION = "create-operation-a";

function routeInput(overrides: Partial<MintPlanGroundingProofV2Input> = {}): MintPlanGroundingProofV2Input {
  return {
    routeVenueIds: ["venue-a", "venue-b", "venue-c"],
    allowedVenueIds: ["venue-a", "venue-b", "venue-c", "venue-d"],
    anchorVenueId: "venue-a",
    anchorSource: "near",
    outcome: "route",
    operationKey: OPERATION,
    ...overrides,
  };
}

function reEncode(proof: string, mutate: (payload: Record<string, unknown>) => void): string {
  const [encoded, signature] = proof.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
  mutate(payload);
  const nextEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${nextEncoded}.${signature}`;
}

describe("grounding proof V2 — mint and verify", () => {
  it("binds an anchored three-Stop Route in exact order", () => {
    const proof = mintPlanGroundingProofV2(routeInput(), ISSUED_AT);
    const verdict = verifyAnchoredPlanGroundingProofV2(proof, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT);
    expect(verdict).toMatchObject({
      ok: true,
      outcome: "route",
      anchored: true,
      anchorVenueId: "venue-a",
      anchorSource: "near",
    });
  });

  it("supports an unanchored grounded Route", () => {
    const proof = mintPlanGroundingProofV2(
      routeInput({ anchorVenueId: null, anchorSource: null }),
      ISSUED_AT,
    );
    const verdict = verifyAnchoredPlanGroundingProofV2(proof, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT);
    expect(verdict).toMatchObject({ ok: true, anchored: false, anchorVenueId: null, anchorSource: null });
  });

  it("binds six ordered stops without changing anchor semantics", () => {
    const routeVenueIds = ["venue-a", "venue-b", "venue-c", "venue-d", "venue-e", "venue-f"];
    const proof = mintPlanGroundingProofV2(routeInput({ routeVenueIds, allowedVenueIds: routeVenueIds }), ISSUED_AT);
    expect(verifyAnchoredPlanGroundingProofV2(proof, routeVenueIds, OPERATION, ISSUED_AT)).toMatchObject({
      ok: true,
      outcome: "route",
      routeVenueIds,
    });
  });

  it("binds a one-Stop anchor-only outcome to its own anchor", () => {
    const proof = mintPlanGroundingProofV2(
      routeInput({
        routeVenueIds: ["venue-a"],
        allowedVenueIds: ["venue-a"],
        outcome: "anchor-only",
      }),
      ISSUED_AT,
    );
    const verdict = verifyAnchoredPlanGroundingProofV2(proof, ["venue-a"], OPERATION, ISSUED_AT);
    expect(verdict).toMatchObject({ ok: true, outcome: "anchor-only", anchored: true, anchorVenueId: "venue-a" });
  });

  it("keeps the allowed set as a sorted superset covering every Stop", () => {
    const proof = mintPlanGroundingProofV2(
      routeInput({ allowedVenueIds: ["venue-e", "venue-a", "venue-c", "venue-b", "venue-a"] }),
      ISSUED_AT,
    );
    const claims = readPlanGroundingClaimsV2(proof);
    expect(claims?.allowedVenueIds).toEqual(["venue-a", "venue-b", "venue-c", "venue-e"]);
  });
});

describe("grounding proof V2 — rejections", () => {
  const proof = mintPlanGroundingProofV2(routeInput(), ISSUED_AT);

  it("returns missing when no proof is supplied", () => {
    for (const value of [null, undefined, ""]) {
      expect(verifyAnchoredPlanGroundingProofV2(value, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT))
        .toEqual({ ok: false, reason: "missing" });
    }
  });

  it("returns malformed for structurally broken proofs", () => {
    expect(verifyAnchoredPlanGroundingProofV2("no-dot", ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT))
      .toEqual({ ok: false, reason: "malformed" });
    expect(verifyAnchoredPlanGroundingProofV2(42, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT))
      .toEqual({ ok: false, reason: "malformed" });
  });

  it("returns tampered when the signature or payload is altered", () => {
    const [encoded, signature] = proof.split(".");
    expect(verifyAnchoredPlanGroundingProofV2(`${encoded}.${signature}x`, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT))
      .toEqual({ ok: false, reason: "tampered" });
    const swappedPayload = reEncode(proof, (payload) => { payload.routeVenueIds = ["venue-x", "venue-b", "venue-c"]; });
    expect(verifyAnchoredPlanGroundingProofV2(swappedPayload, ["venue-x", "venue-b", "venue-c"], OPERATION, ISSUED_AT))
      .toEqual({ ok: false, reason: "tampered" });
  });

  it("returns operation-mismatch for a different or empty operation key", () => {
    expect(verifyAnchoredPlanGroundingProofV2(proof, ["venue-a", "venue-b", "venue-c"], "other-operation", ISSUED_AT))
      .toEqual({ ok: false, reason: "operation-mismatch" });
    expect(verifyAnchoredPlanGroundingProofV2(proof, ["venue-a", "venue-b", "venue-c"], "   ", ISSUED_AT))
      .toEqual({ ok: false, reason: "operation-mismatch" });
  });

  it("returns route-mismatch for reordered, substituted, or short Stop lists", () => {
    expect(verifyAnchoredPlanGroundingProofV2(proof, ["venue-b", "venue-a", "venue-c"], OPERATION, ISSUED_AT))
      .toEqual({ ok: false, reason: "route-mismatch" });
    expect(verifyAnchoredPlanGroundingProofV2(proof, ["venue-a", "venue-b", "venue-d"], OPERATION, ISSUED_AT))
      .toEqual({ ok: false, reason: "route-mismatch" });
    expect(verifyAnchoredPlanGroundingProofV2(proof, ["venue-a", "venue-b"], OPERATION, ISSUED_AT))
      .toEqual({ ok: false, reason: "route-mismatch" });
  });

  it("returns expired only after the TTL, and stays valid up to it", () => {
    expect(verifyAnchoredPlanGroundingProofV2(proof, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT + PLAN_GROUNDING_PROOF_TTL_MS))
      .toMatchObject({ ok: true });
    expect(verifyAnchoredPlanGroundingProofV2(proof, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT + PLAN_GROUNDING_PROOF_TTL_MS + 1))
      .toEqual({ ok: false, reason: "expired" });
  });
});

describe("grounding proof V2 — mint invariants", () => {
  it("refuses inconsistent anchor, source, outcome, and Stop counts", () => {
    expect(() => mintPlanGroundingProofV2(routeInput({ routeVenueIds: ["venue-a"], outcome: "route" }), ISSUED_AT)).toThrow();
    expect(() => mintPlanGroundingProofV2(routeInput({ routeVenueIds: ["venue-a", "venue-b", "venue-c"], outcome: "anchor-only" }), ISSUED_AT)).toThrow();
    expect(() => mintPlanGroundingProofV2(routeInput({ anchorVenueId: "venue-b" }), ISSUED_AT)).toThrow();
    expect(() => mintPlanGroundingProofV2(routeInput({ anchorVenueId: "venue-a", anchorSource: null }), ISSUED_AT)).toThrow();
    expect(() => mintPlanGroundingProofV2(routeInput({ allowedVenueIds: ["venue-b", "venue-c", "venue-d"] }), ISSUED_AT)).toThrow();
    expect(() => mintPlanGroundingProofV2(routeInput({ routeVenueIds: ["venue-a", "venue-a", "venue-c"] }), ISSUED_AT)).toThrow();
    expect(() => mintPlanGroundingProofV2(routeInput({ operationKey: "  " }), ISSUED_AT)).toThrow();
  });
});

describe("grounding proof V1 and V2 stay isolated", () => {
  it("does not cross-verify between proof versions", () => {
    const v2 = mintPlanGroundingProofV2(routeInput(), ISSUED_AT);
    const v1 = mintPlanGroundingProof(["venue-a", "venue-b", "venue-c", "venue-d"], OPERATION, ISSUED_AT);

    // A V2 proof is not a valid legacy unanchored three-Stop proof.
    expect(verifyPlanGroundingProof(v2, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT)).toBe(false);
    // A V1 proof does not satisfy the V2 anchored verifier.
    expect(verifyAnchoredPlanGroundingProofV2(v1, ["venue-a", "venue-b", "venue-c"], OPERATION, ISSUED_AT).ok).toBe(false);
    expect(readPlanGroundingClaimsV2(v1)).toBeNull();
  });
});
