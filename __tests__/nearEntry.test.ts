import { describe, expect, it } from "vitest";

import { resolveNearAutoLocate } from "@/components/nearme/NearPageClient";
import { shouldStartNearAutoLocate } from "@/components/nearme/NearMeNow";

describe("Near explicit location entry", () => {
  it("auto-locates only for exact locate=1 intent", () => {
    expect(resolveNearAutoLocate(new URLSearchParams("locate=1"))).toBe(true);
    expect(resolveNearAutoLocate(new URLSearchParams("locate=0"))).toBe(false);
    expect(resolveNearAutoLocate(new URLSearchParams("locate=true"))).toBe(false);
    expect(resolveNearAutoLocate(new URLSearchParams())).toBe(false);
  });

  it("consumes locate intent once and never over an active patch", () => {
    const input = {
      autoLocate: true,
      alreadyStarted: false,
      hasInitialLocation: false,
      bootPatchId: null,
    };
    expect(shouldStartNearAutoLocate(input)).toBe(true);
    expect(shouldStartNearAutoLocate({ ...input, alreadyStarted: true })).toBe(false);
    expect(shouldStartNearAutoLocate({ ...input, bootPatchId: "central" })).toBe(false);
  });
});
