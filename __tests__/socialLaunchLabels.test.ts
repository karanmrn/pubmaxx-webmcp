import { describe, expect, it } from "vitest";

import {
  adultSelfAssertionLine,
  socialBoundaryCopy,
  socialInviteMessage,
  socialLoadingLabel,
  socialSurfaceName,
} from "@/lib/socialLaunch";

describe("social preview labels", () => {
  it("reads Social preview on surfaces while friends launch is off", () => {
    expect(socialSurfaceName(false)).toBe("Social preview");
    expect(socialLoadingLabel(false)).toBe("Loading Social preview");
    expect(socialInviteMessage(false)).toBe("Use Social preview.");
    expect(socialBoundaryCopy("preview", false)).toBe(
      "Social preview is invite-only for now. It opens more widely soon.",
    );
    expect(adultSelfAssertionLine(false)).toBe("Social preview is for over-18s.");
  });

  it("reads Social when friends launch is on", () => {
    expect(socialSurfaceName(true)).toBe("Social");
    expect(socialLoadingLabel(true)).toBe("Loading Social");
    expect(socialInviteMessage(true)).toBe("Use Social.");
    expect(socialBoundaryCopy("sign_in_required", true)).toBe(
      "Sign in to use Social.",
    );
    expect(adultSelfAssertionLine(true)).toBe("Social is for over-18s.");
  });
});
