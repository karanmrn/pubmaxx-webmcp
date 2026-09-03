import { describe, expect, it } from "vitest";

import { parsePlanGenerationRequest } from "@/lib/planGenerationRequest";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function request(body: unknown): Request {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("parsePlanGenerationRequest", () => {
  it("treats an explicit null legacy context like an omitted context when intake is absent", async () => {
    const omitted = await parsePlanGenerationRequest(request({ query: "Clapham classics" }), NOW);
    const explicitNull = await parsePlanGenerationRequest(
      request({ query: "Clapham classics", context: null }),
      NOW,
    );

    expect(explicitNull).toEqual(omitted);
    expect(explicitNull).toEqual({
      ok: true,
      value: {
        query: "Clapham classics",
        context: null,
        cityId: null,
        intake: null,
        hasIntake: false,
        operationKey: null,
        anchor: null,
      },
    });
  });

  it.each([
    ["a string", "clapham"],
    ["an array", []],
    ["an unknown key", { unknown: true }],
    ["an invalid known value", { groupSize: 0 }],
    ["a non-boolean wetherspoonsPreferred", { wetherspoonsPreferred: "yes" }],
  ])("still rejects non-null malformed context: %s", async (_label, context) => {
    const result = await parsePlanGenerationRequest(request({ query: "Clapham classics", context }), NOW);

    expect(result).toEqual({
      ok: false,
      code: "MALFORMED_REQUEST",
      message: "Night Context is invalid.",
      status: 400,
    });
  });

  it("allowlists wetherspoonsPreferred as a boolean Night Context field", async () => {
    const result = await parsePlanGenerationRequest(
      request({ query: "Spoons in Clapham", context: { wetherspoonsPreferred: true } }),
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        query: "Spoons in Clapham",
        context: { wetherspoonsPreferred: true },
        cityId: null,
        intake: null,
        hasIntake: false,
        operationKey: null,
        anchor: null,
      },
    });
  });

  it("allowlists a requested three-to-six stop count", async () => {
    const result = await parsePlanGenerationRequest(
      request({ query: "Camden", context: { stopCount: 6 } }),
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      value: { context: { stopCount: 6 } },
    });
  });

  it("rejects stop counts outside the planner choices", async () => {
    const result = await parsePlanGenerationRequest(
      request({ query: "Camden", context: { stopCount: 7 } }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "MALFORMED_REQUEST" });
  });
});
