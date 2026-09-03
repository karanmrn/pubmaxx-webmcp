import { describe, expect, it } from "vitest";

import {
  analyticsPageviewSurfaceFromPath,
  analyticsReferrerFromUrl,
} from "@/lib/analyticsPath";
import { analyticsSurfaceFromPath } from "@/lib/analyticsSurface";

describe("analytics referrer boundary", () => {
  it("allows only query-free canonical Social surface names", () => {
    expect(analyticsSurfaceFromPath("/social?feed=nearby&area=camden")).toBe("/social");
    expect(analyticsPageviewSurfaceFromPath("/social?tab=discover")).toBe("/social");
  });

  it.each([
    [
      "https://pubmaxxing.com/u/private-handle?utm_source=secret#profile",
      "https://pubmaxxing.com/u/[handle]",
    ],
    [
      "https://pubmaxxing.com/rounds/secret-code?member=private",
      "https://pubmaxxing.com/rounds/[code]",
    ],
    [
      "https://pubmaxxing.com/map?ask=free-text#sheet",
      "https://pubmaxxing.com/map",
    ],
  ])("coarsens same-origin referrer %s", (referrer, expected) => {
    expect(analyticsReferrerFromUrl(referrer, "https://pubmaxxing.com/map")).toBe(expected);
  });

  it("drops unrecognised same-origin paths", () => {
    expect(
      analyticsReferrerFromUrl(
        "https://pubmaxxing.com/private/free-text?member=secret",
        "https://pubmaxxing.com/map",
      ),
    ).toBeNull();
  });

  it("reduces external referrers to origin", () => {
    expect(
      analyticsReferrerFromUrl(
        "https://search.example/private/path?ask=free-text#results",
        "https://pubmaxxing.com/map",
      ),
    ).toBe("https://search.example");
  });
});
