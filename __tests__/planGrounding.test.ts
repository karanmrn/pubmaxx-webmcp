import { describe, expect, it } from "vitest";

import { mintPlanGroundingProof, verifyPlanGroundingProof } from "@/lib/planGrounding.server";

describe("server-owned Plan grounding proof", () => {
  const candidates = ["venue-a", "venue-b", "venue-c", "venue-d"];
  const issuedAt = Date.parse("2026-07-20T12:00:00.000Z");
  const operationKey = "create-operation-a";

  it("covers exactly three accepted venues from the generated candidate set", () => {
    const proof = mintPlanGroundingProof(candidates, operationKey, issuedAt);

    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-c"], operationKey, issuedAt)).toBe(true);
    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-d"], operationKey, issuedAt)).toBe(true);
  });

  it("fails closed for edits, client forgery, duplicates, and malformed proofs", () => {
    const proof = mintPlanGroundingProof(candidates, operationKey, issuedAt);
    const [payload, signature] = proof.split(".");

    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-x"], operationKey, issuedAt)).toBe(false);
    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-a", "venue-b"], operationKey, issuedAt)).toBe(false);
    expect(verifyPlanGroundingProof(`${payload}.${signature}x`, ["venue-a", "venue-b", "venue-c"], operationKey, issuedAt)).toBe(false);
    expect(verifyPlanGroundingProof(true, ["venue-a", "venue-b", "venue-c"], operationKey, issuedAt)).toBe(false);
  });

  it("binds a proof to one create operation and expires it", () => {
    const proof = mintPlanGroundingProof(candidates, "create-operation-a", issuedAt);

    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-c"], "create-operation-a", issuedAt + 1_000)).toBe(true);
    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-c"], "create-operation-b", issuedAt + 1_000)).toBe(false);
    expect(verifyPlanGroundingProof(proof, ["venue-a", "venue-b", "venue-c"], "create-operation-a", issuedAt + 2 * 60 * 60 * 1_000 + 1)).toBe(false);
  });
});
