import { describe, expect, it } from "vitest";

import { publicApiError } from "@/lib/apiError";

describe("publicApiError", () => {
  it("preserves THE LOCAL's flat, no-store error contract", async () => {
    const response = publicApiError("Try again.", "TEMPORARY", 503, {
      retryable: true,
      details: { reason: "upstream" },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "Try again.",
      code: "TEMPORARY",
      retryable: true,
      details: { reason: "upstream" },
    });
  });
});
