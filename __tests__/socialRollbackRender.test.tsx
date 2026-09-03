import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ identityResolved: true, user: null }),
}));

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));

vi.mock("@/app/discover/DiscoverPageClient", () => ({
  DiscoverBody: () => createElement("div", null, "Discover body"),
}));

vi.mock("@/components/profile/HandleAvatar", () => ({
  default: () => null,
}));

vi.mock("@/components/social/CrewsPanel", () => ({
  default: () => createElement("div", null, "Crews panel"),
}));

vi.mock("@/components/social/CreatorListsLane", () => ({
  default: () => createElement("div", null, "Creator lists"),
}));

vi.mock("@/components/social/FindYourLot", () => ({
  default: () => createElement("div", null, "Find your lot"),
}));

vi.mock("@/components/social/PeopleDirectory", () => ({
  default: () => createElement("div", null, "People directory"),
}));

vi.mock("@/components/social/StarterPacks", () => ({
  default: () => createElement("div", null, "Starter packs"),
}));

vi.mock("@/components/social/SocialViewerState", () => ({
  SocialViewerState: () => createElement("div", null, "Viewer state"),
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn(),
}));

vi.mock("@/lib/deviceAccountIdentity", () => ({
  subscribeDeviceIdentity: () => () => {},
}));

import SocialPageClient from "@/app/social/SocialPageClient";

const postsState = {
  valid: true as const,
  tab: "posts" as const,
  feed: "following" as const,
  area: null,
};

const discoverState = {
  valid: true as const,
  tab: "discover" as const,
  feed: null,
  area: null,
};

function renderRollback(initialState: typeof postsState | typeof discoverState): string {
  return renderToStaticMarkup(
    createElement(SocialPageClient, {
      initialState,
      rivalry: [],
      heritageCrawls: [],
      friendsLaunchEnabled: false,
    }),
  );
}

describe("Social emergency rollback rendering", () => {
  it.each([postsState, discoverState])(
    "shows preview instead of protected or discover content for %s",
    (initialState) => {
      const html = renderRollback(initialState);

      expect(html).toContain(
        "Social preview is invite-only for now. It opens more widely soon.",
      );
      expect(html).not.toContain("Sign in to use Social.");
      expect(html).not.toContain("Discover body");
      expect(html).not.toContain("socialDiscoverBody");
      expect(html).not.toContain("Starter packs");
      expect(html).not.toContain("Find your lot");
      expect(html).not.toContain("Crews panel");
    },
  );
});
