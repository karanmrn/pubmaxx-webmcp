import { describe, expect, it } from "vitest";

import { pickMapSurfaceToast } from "@/lib/mapSurfaceChrome";

describe("pickMapSurfaceToast", () => {
  it("keeps one toast when a tile retry and a lookup note both want the surface", () => {
    expect(
      pickMapSurfaceToast({ selectionNotice: true, softRetry: true }),
    ).toBe("soft-retry");
    expect(
      pickMapSurfaceToast({
        selectionNotice: true,
        selectionNoticePriority: true,
        softRetry: true,
      }),
    ).toBe("selection");
    expect(
      pickMapSurfaceToast({ selectionNotice: true, softRetry: false }),
    ).toBe("selection");
    expect(
      pickMapSurfaceToast({ selectionNotice: false, softRetry: false }),
    ).toBe("none");
  });
});
