import { describe, expect, it } from "vitest";

import {
  SOCIAL_PROVIDER_CAPABILITIES,
  availableProviderCapabilities,
  providerCapability,
} from "@/lib/socialProviderCapabilities";

describe("social provider capabilities", () => {
  it("keeps manual links available without claiming uncertified provider access", () => {
    expect(SOCIAL_PROVIDER_CAPABILITIES.instagram).toEqual({
      manual_link: true,
      oauth_identity: false,
      read_selected_content: false,
      publish: false,
    });
    expect(SOCIAL_PROVIDER_CAPABILITIES.tiktok).toEqual({
      manual_link: true,
      oauth_identity: false,
      read_selected_content: false,
      publish: false,
    });
    expect(SOCIAL_PROVIDER_CAPABILITIES.letterboxd).toEqual({
      manual_link: true,
      oauth_identity: false,
      read_selected_content: false,
      publish: false,
    });
  });

  it("does not infer a broader capability from another capability", () => {
    expect(providerCapability("instagram", "manual_link")).toBe(true);
    expect(providerCapability("instagram", "oauth_identity")).toBe(false);
    expect(providerCapability("instagram", "read_selected_content")).toBe(false);
    expect(providerCapability("instagram", "publish")).toBe(false);
  });

  it("requires runtime readiness after certification", () => {
    const certified = {
      manual_link: true,
      oauth_identity: true,
      read_selected_content: false,
      publish: false,
    };

    expect(availableProviderCapabilities(certified, false).oauth_identity).toBe(false);
    expect(availableProviderCapabilities(certified, true).oauth_identity).toBe(true);
  });
});
