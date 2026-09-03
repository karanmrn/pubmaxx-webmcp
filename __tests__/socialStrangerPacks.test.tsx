// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerSession } from "@/components/auth/useViewerSession";
import type { SocialShellState } from "@/lib/socialShell";

const authState = vi.hoisted(() => ({
  accountRevision: 0,
  identityResolved: true,
  user: null as { id: string } | null,
}));

const viewerSession = vi.hoisted(() => ({
  current: {
    phase: "signed-out" as ViewerSession["phase"],
    signedIn: false,
    signedOut: true,
    unresolved: false,
  },
}));

const transport = vi.hoisted(() => ({
  authedActionFetch: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/social",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => viewerSession.current,
}));

vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: transport.authedActionFetch,
}));

vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => true,
}));

vi.mock("@/lib/deviceAccountIdentity", () => ({
  subscribeDeviceIdentity: () => () => undefined,
}));

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/founding/FoundersWallLink", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({
  default: () => createElement("div", { "data-viewer-card": "crews" }),
}));
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/app/discover/DiscoverPageClient", () => ({ DiscoverBody: () => null }));
vi.mock("@/app/social/SocialComposer", () => ({
  default: () => createElement("div", { "data-viewer-card": "composer" }),
}));
vi.mock("@/app/social/SocialOutbox", () => ({
  default: () => createElement("div", { "data-viewer-card": "outbox" }),
}));
vi.mock("@/app/social/SocialTagInbox", () => ({
  default: () => createElement("div", { "data-viewer-card": "tag-inbox" }),
}));

import SocialPageClient from "@/app/social/SocialPageClient";

const initialState = {
  valid: true as const,
  tab: "posts" as const,
  feed: "following" as const,
  area: null,
};

const publicPack = {
  slug: "camden",
  title: "Drinkers of Camden",
  description: "Accounts whose profile says Camden.",
  kind: "borough" as const,
  borough: "Camden",
  members: [{ handle: "alice" }],
  memberCount: 3,
};

function packResponse(): Response {
  return new Response(
    JSON.stringify({ packs: [publicPack], viewerFollowing: null }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;
type SocialRenderState = SocialShellState;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.accountRevision = 0;
  authState.identityResolved = true;
  authState.user = null;
  viewerSession.current = {
    phase: "signed-out",
    signedIn: false,
    signedOut: true,
    unresolved: false,
  };
  transport.authedActionFetch.mockReset();
  transport.authedActionFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href === "/api/starter-packs") return packResponse();
    if (href === "/api/social/access") {
      return jsonResponse({
        state: "verified",
        draftScope: "a".repeat(43),
        viewerHandle: "alice",
      });
    }
    if (href.startsWith("/api/social/interactions")) {
      return jsonResponse({ items: [] });
    }
    if (href.startsWith("/api/social/posts")) {
      return jsonResponse({ posts: [], nextCursor: null });
    }
    throw new Error(`Unexpected request: ${href}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderSocial(state: SocialRenderState = initialState): Promise<void> {
  await act(async () => {
    root.render(
      createElement(SocialPageClient, {
        initialState: state,
        rivalry: [],
        heritageCrawls: [],
      }),
    );
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}

describe("Social viewer surfaces", () => {
  it("renders public pack cards beside one sign-in action without follow controls", async () => {
    await renderSocial();

    expect(host.querySelector(".socialBoundary")?.textContent).toContain(
      "Sign in to use Social.",
    );
    expect(host.querySelectorAll('a[href*="/login"]')).toHaveLength(1);
    expect(host.querySelectorAll(".starterPacks__card")).toHaveLength(1);
    expect(host.querySelectorAll(".starterPacks__follow")).toHaveLength(0);
    expect(host.querySelectorAll(".starterPacks__card button")).toHaveLength(0);
    expect(host.querySelectorAll("[data-viewer-card]")).toHaveLength(0);
    expect(transport.authedActionFetch).toHaveBeenCalledWith(
      "/api/starter-packs",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("shows viewer cards only for a verified viewer on Posts", async () => {
    authState.user = { id: "account-a" };
    viewerSession.current = {
      phase: "signed-in",
      signedIn: true,
      signedOut: false,
      unresolved: false,
    };

    await renderSocial();

    expect(
      Array.from(host.querySelectorAll<HTMLElement>("[data-viewer-card]"),
        (card) => card.dataset.viewerCard,
      ),
    ).toEqual(["composer", "tag-inbox", "outbox", "crews"]);
  });

  it("withholds viewer cards while viewer session is unresolved", async () => {
    authState.user = null;
    viewerSession.current = {
      phase: "unresolved",
      signedIn: false,
      signedOut: false,
      unresolved: true,
    };

    await renderSocial();

    expect(host.querySelectorAll("[data-viewer-card]")).toHaveLength(0);
  });

  it("withholds viewer cards outside Posts", async () => {
    authState.user = { id: "account-a" };
    viewerSession.current = {
      phase: "signed-in",
      signedIn: true,
      signedOut: false,
      unresolved: false,
    };

    await renderSocial({ valid: true, tab: "discover", feed: null, area: null });

    expect(host.querySelectorAll("[data-viewer-card]")).toHaveLength(0);
  });
});
