// @vitest-environment jsdom

import { createElement, useState, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SocialPostDTO } from "@/lib/socialPosts";

const authState = vi.hoisted(() => ({
  accountRevision: 1,
  identityResolved: true,
  user: { id: "account-a" } as { id: string } | null,
}));

type ViewerState = {
  phase: "unresolved" | "signed-in" | "signed-out";
  signedIn: boolean;
  signedOut: boolean;
  unresolved: boolean;
};

const viewerState = vi.hoisted(() => ({
  current: {} as ViewerState,
}));

const transport = vi.hoisted(() => ({
  authedActionFetch: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => viewerState.current,
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: transport.authedActionFetch,
}));

vi.mock("@/lib/deviceAccountIdentity", () => ({
  subscribeDeviceIdentity: () => () => undefined,
}));

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));

vi.mock("@/components/profile/HandleAvatar", () => ({
  default: () => createElement("span", null, "Avatar"),
}));

vi.mock("@/app/discover/DiscoverPageClient", () => ({
  DiscoverBody: () => createElement("div", null, "Discover"),
}));

function PrivateStateProbe({ label, viewerHandle }: { label: string; viewerHandle?: string | null }) {
  const [owner] = useState(authState.user?.id ?? "signed-out");
  return createElement("div", null, `${label}:${owner}:${viewerHandle ?? "none"}`);
}

vi.mock("@/components/social/CrewsPanel", () => ({
  default: ({ viewerHandle }: { viewerHandle?: string | null }) =>
    createElement(PrivateStateProbe, { label: "crew", viewerHandle }),
}));

vi.mock("@/components/social/StarterPacks", () => ({
  default: () => createElement(PrivateStateProbe, { label: "friends" }),
}));

vi.mock("@/components/social/FindYourLot", () => ({
  default: ({ myHandle }: { myHandle?: string | null }) =>
    createElement(PrivateStateProbe, { label: "find", viewerHandle: myHandle }),
}));

vi.mock("@/components/social/PeopleDirectory", () => ({
  default: () => createElement("div", null, "People"),
}));

vi.mock("@/components/social/CreatorListsLane", () => ({
  default: () => createElement("div", null, "Lists"),
}));

vi.mock("@/app/social/SocialTagInbox", () => ({
  default: () => createElement(PrivateStateProbe, { label: "tags" }),
}));

const A_FEED_POST: SocialPostDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "standard",
  visibility: "friends",
  body: "Account A feed post",
  area: null,
  venueId: null,
  venueProjected: false,
  hashtags: [],
  commentPolicy: "open",
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 1,
  mutationVersion: 1,
  editedAt: null,
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  author: { handle: "alice" },
  ownedByViewer: true,
  venueName: null,
};

const A_OUTBOX_POST: SocialPostDTO = {
  ...A_FEED_POST,
  id: "22222222-2222-4222-8222-222222222222",
  visibility: "private",
  body: "Account A private outbox post",
  moderationState: "pending",
};

const A_SUBMITTED_POST: SocialPostDTO = {
  ...A_OUTBOX_POST,
  id: "33333333-3333-4333-8333-333333333333",
  body: "Account A newly submitted post",
};

const B_FEED_POST: SocialPostDTO = {
  ...A_FEED_POST,
  id: "44444444-4444-4444-8444-444444444444",
  body: "Account B feed post",
  author: { handle: "bob" },
};

const B_OUTBOX_POST: SocialPostDTO = {
  ...A_OUTBOX_POST,
  id: "55555555-5555-4555-8555-555555555555",
  body: "Account B private outbox post",
  author: { handle: "bob" },
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

vi.mock("@/app/social/SocialComposer", () => ({
  default: ({ onSaved, post }: { onSaved: (post?: SocialPostDTO) => void; post?: SocialPostDTO }) =>
    createElement(
      "button",
      {
        type: "button",
        "data-compose": post ? "edit" : "new",
        onClick: () => onSaved(A_SUBMITTED_POST),
      },
      post ? "Edit" : "Submit A post",
    ),
}));

import SocialPageClient from "@/app/social/SocialPageClient";
import SocialOutbox from "@/app/social/SocialOutbox";

const initialState = {
  valid: true as const,
  tab: "posts" as const,
  feed: "following" as const,
  area: null,
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.accountRevision = 1;
  authState.identityResolved = true;
  authState.user = { id: "account-a" };
  viewerState.current = {
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  };
  transport.authedActionFetch.mockReset();
  transport.authedActionFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const href = String(input);
    if (authState.user?.id !== "account-a") return new Promise<Response>(() => undefined);
    if (href === "/api/social/access") {
      return json({
        state: "verified",
        draftScope: "a".repeat(43),
        viewerHandle: "alice",
      });
    }
    if (href.startsWith("/api/social/interactions")) return json({ items: [] });
    if (href.startsWith("/api/social/outbox")) {
      return json({ posts: [A_OUTBOX_POST], nextCursor: null });
    }
    if (href.startsWith("/api/social/posts")) {
      return json({ posts: [A_FEED_POST], nextCursor: null });
    }
    throw new Error(`Unexpected authed request: ${href}`);
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.startsWith("/api/social/outbox")) {
      if (authState.user?.id !== "account-a") return new Promise<Response>(() => undefined);
      return json({ posts: [A_OUTBOX_POST], nextCursor: null });
    }
    throw new Error(`Unexpected bare request: ${href}`);
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function flushAccountA(): Promise<void> {
  await act(async () => {
    root.render(createElement(SocialPageClient, {
      initialState,
      rivalry: [],
      heritageCrawls: [],
    }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Social account boundary", () => {
  it("keeps Social neutral while the viewer session is unavailable", async () => {
    authState.user = null;
    authState.identityResolved = true;
    viewerState.current = {
      phase: "unresolved",
      signedIn: false,
      signedOut: false,
      unresolved: true,
    };

    await act(async () => {
      root.render(createElement(SocialPageClient, {
        initialState,
        rivalry: [],
        heritageCrawls: [],
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Sign in to use Social");
    expect(host.textContent).not.toContain("Sign in to invite");
    expect(host.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("never renders account A Social state after account B becomes current", async () => {
    await flushAccountA();

    expect(host.textContent).toContain(A_FEED_POST.body);
    expect(host.textContent).toContain(A_OUTBOX_POST.body);
    expect(host.textContent).toContain("crew:account-a:alice");
    expect(host.textContent).toContain("friends:account-a:none");

    const submit = host.querySelector<HTMLButtonElement>('button[data-compose="new"]');
    await act(async () => submit?.click());
    expect(host.textContent).toContain(A_SUBMITTED_POST.body);

    authState.user = { id: "account-b" };
    authState.accountRevision = 2;
    act(() => {
      root.render(createElement(SocialPageClient, {
        initialState,
        rivalry: [],
        heritageCrawls: [],
      }));
    });

    expect(host.textContent).not.toContain("account-a");
    expect(host.textContent).not.toContain("alice");
    expect(host.textContent).not.toContain(A_FEED_POST.body);
    expect(host.textContent).not.toContain(A_OUTBOX_POST.body);
    expect(host.textContent).not.toContain(A_SUBMITTED_POST.body);
  });

  it("loads the outbox through bearer auth without a cookie fallback", async () => {
    transport.authedActionFetch.mockReset();
    transport.authedActionFetch.mockResolvedValue(
      json({ posts: [A_OUTBOX_POST], nextCursor: null }),
    );
    const bareFetch = vi.fn(async () => {
      throw new Error("Bare fetch has no authenticated session.");
    });
    vi.stubGlobal("fetch", bareFetch);

    await act(async () => {
      root.render(createElement(SocialOutbox, {
        draftScope: "a".repeat(43),
        submittedPost: null,
        onPostChanged: () => undefined,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain(A_OUTBOX_POST.body);
    expect(transport.authedActionFetch).toHaveBeenCalledWith(
      "/api/social/outbox",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(bareFetch).not.toHaveBeenCalled();
  });

  it("discards late account A replies and aborts its active load-more request", async () => {
    const lateAOutbox = deferred<Response>();
    const lateAMore = deferred<Response>();
    let aFeedReads = 0;

    transport.authedActionFetch.mockReset();
    transport.authedActionFetch.mockImplementation(
      (input: RequestInfo | URL) => {
        const href = String(input);
        const accountId = authState.user?.id;
        if (accountId === "account-a") {
          if (href === "/api/social/access") {
            return Promise.resolve(json({
              state: "verified",
              draftScope: "a".repeat(43),
              viewerHandle: "alice",
            }));
          }
          if (href.startsWith("/api/social/interactions")) {
            return Promise.resolve(json({ items: [] }));
          }
          if (href.startsWith("/api/social/outbox")) return lateAOutbox.promise;
          if (href.startsWith("/api/social/posts")) {
            aFeedReads += 1;
            if (aFeedReads === 1) {
              return Promise.resolve(json({ posts: [A_FEED_POST], nextCursor: "a-next" }));
            }
            return lateAMore.promise;
          }
        }
        if (accountId === "account-b") {
          if (href === "/api/social/access") {
            return Promise.resolve(json({
              state: "verified",
              draftScope: "b".repeat(43),
              viewerHandle: "bob",
            }));
          }
          if (href.startsWith("/api/social/interactions")) {
            return Promise.resolve(json({ items: [] }));
          }
          if (href.startsWith("/api/social/outbox")) {
            return Promise.resolve(json({ posts: [B_OUTBOX_POST], nextCursor: null }));
          }
          if (href.startsWith("/api/social/posts")) {
            return Promise.resolve(json({ posts: [B_FEED_POST], nextCursor: null }));
          }
        }
        return Promise.reject(new Error(`Unexpected request for ${accountId}: ${href}`));
      },
    );

    await act(async () => {
      root.render(createElement(SocialPageClient, {
        initialState,
        rivalry: [],
        heritageCrawls: [],
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain(A_FEED_POST.body);

    const loadMore = [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Load more");
    await act(async () => loadMore?.click());
    const loadMoreCall = transport.authedActionFetch.mock.calls.find(
      ([input]) => String(input).includes("cursor=a-next"),
    );
    const aLoadMoreSignal = loadMoreCall?.[1]?.signal;
    expect(aLoadMoreSignal).toBeDefined();
    expect(aLoadMoreSignal?.aborted).toBe(false);

    authState.user = { id: "account-b" };
    authState.accountRevision = 2;
    await act(async () => {
      root.render(createElement(SocialPageClient, {
        initialState,
        rivalry: [],
        heritageCrawls: [],
      }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(aLoadMoreSignal?.aborted).toBe(true);
    expect(host.textContent).toContain(B_FEED_POST.body);
    expect(host.textContent).toContain(B_OUTBOX_POST.body);

    await act(async () => {
      lateAMore.resolve(json({ posts: [A_FEED_POST], nextCursor: null }));
      lateAOutbox.resolve(json({ posts: [A_OUTBOX_POST], nextCursor: null }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain(B_FEED_POST.body);
    expect(host.textContent).toContain(B_OUTBOX_POST.body);
    expect(host.textContent).not.toContain(A_FEED_POST.body);
    expect(host.textContent).not.toContain(A_OUTBOX_POST.body);
  });
});
