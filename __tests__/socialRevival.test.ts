import { describe, expect, it } from "vitest";

import {
  adultSelfAssertionLine,
  socialBoundaryCopy,
  socialDocumentRobots,
  socialInviteMessage,
  socialListedInSitemap,
  socialLoadingLabel,
  socialSurfaceName,
} from "@/lib/socialLaunch";

describe("Social stable launch", () => {
  it("uses live Social naming and indexing without a rollout flag", () => {
    expect(socialSurfaceName()).toBe("Social");
    expect(socialDocumentRobots()).toEqual({ index: true, follow: true });
    expect(socialListedInSitemap()).toBe(true);
  });

  it("uses live Social copy for every boundary", () => {
    expect(socialBoundaryCopy("sign_in_required")).toBe("Sign in to use Social.");
    expect(socialInviteMessage()).toBe("Use Social.");
    expect(socialLoadingLabel()).toBe("Loading Social");
    expect(adultSelfAssertionLine()).toBe("Social is for over-18s.");
  });
});
