import { describe, expect, it } from "vitest";

import { resolveNearAutoLocate } from "@/components/nearme/NearPageClient";

describe("Near page auto-location", () => {
  it("starts location only for the explicit landing request", () => {
    expect(resolveNearAutoLocate(new URLSearchParams("locate=1"))).toBe(true);
    expect(resolveNearAutoLocate(new URLSearchParams("locate=true"))).toBe(false);
    expect(resolveNearAutoLocate(new URLSearchParams(""))).toBe(false);
  });
});
