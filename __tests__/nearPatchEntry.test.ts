import { describe, expect, it } from "vitest";

import { NIGHT_PATCHES, resolveNightPatch } from "@/lib/nightPatches";

describe("near patch deep links", () => {
  it("resolves every nightlife patch id for /near?patch=", () => {
    for (const patch of NIGHT_PATCHES) {
      expect(resolveNightPatch(patch.id)?.id).toBe(patch.id);
    }
  });

  it("ignores unknown patch ids so /near stays idle-first", () => {
    expect(resolveNightPatch("not-a-patch")).toBeNull();
    expect(resolveNightPatch("")).toBeNull();
  });
});
