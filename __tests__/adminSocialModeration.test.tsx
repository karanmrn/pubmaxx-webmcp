// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", props),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Site navigation"),
}));
vi.mock("@/app/admin/VenuePhotoModeration", () => ({
  default: () => null,
}));

import AdminClient from "@/app/admin/AdminClient";

const state = vi.hoisted(() => ({
  pintDropsFail: false,
  socialPosts: [] as Array<{
    staffDisplayName: string;
    postId: string;
    mediaId: string | null;
    revision: number;
    authorHandle: string;
    body: string;
    photoAltText: string | null;
    area: string | null;
    venueId: string | null;
    visibility: "public" | "friends" | "private";
    commentPolicy: "open" | "friends" | "locked";
    moderationClaim: string;
    moderationState: "needs_review" | "approved";
    createdAt: string;
    updatedAt: string;
  }>,
  socialUnavailable: false,
  socialActionStatus: 200,
  socialActionGate: null as Promise<void> | null,
  socialActionBodies: [] as unknown[],
}));

let host: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responseFor(input: string, init?: RequestInit): Response | Promise<Response> {
  const url = new URL(input, "http://localhost");
  const method = init?.method ?? "GET";
  if (url.pathname === "/api/admin/session") {
    return method === "POST" ? jsonResponse({ ok: true }) : jsonResponse({ authenticated: true });
  }
  if (url.pathname === "/api/admin/social-posts") {
    if (method === "POST") {
      state.socialActionBodies.push(JSON.parse(String(init?.body)));
      const response = () => state.socialActionStatus === 200
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "unavailable" }, state.socialActionStatus);
      return state.socialActionGate ? state.socialActionGate.then(response) : response();
    }
    return state.socialUnavailable
      ? jsonResponse({ error: "unavailable" }, 503)
      : jsonResponse({ posts: state.socialPosts });
  }
  if (url.pathname.startsWith("/api/pint-drops")) {
    return state.pintDropsFail ? jsonResponse({ error: "unavailable" }, 503) : jsonResponse({ drops: [] });
  }
  if (url.pathname === "/api/admin/community-prices") return jsonResponse({ prices: [] });
  if (url.pathname.startsWith("/api/admin/comments")) return jsonResponse({ comments: [] });
  if (url.pathname.startsWith("/api/visit-reports")) return jsonResponse({ reports: [] });
  if (url.pathname.startsWith("/api/venue-photos")) return jsonResponse({ photos: [] });
  if (url.pathname.startsWith("/api/admin/profile-avatars")) {
    return jsonResponse({ avatars: [], rotationCovers: [] });
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`);
}

async function loadAdmin(): Promise<void> {
  await act(async () => {
    root.render(createElement(AdminClient));
  });
  const load = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Load reported drops"),
  );
  expect(load).toBeTruthy();
  await act(async () => {
    load!.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem("pubmax_admin_token", "admin-token");
  state.pintDropsFail = false;
  state.socialPosts = [];
  state.socialUnavailable = false;
  state.socialActionStatus = 200;
  state.socialActionGate = null;
  state.socialActionBodies = [];
  vi.stubGlobal("fetch", vi.fn(responseFor));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Admin Social post moderation queue", () => {
  const heldPost = {
    staffDisplayName: "Captain",
    postId: "11111111-1111-4111-8111-111111111111",
    mediaId: "22222222-2222-4222-8222-222222222222",
    revision: 4,
    authorHandle: "alice",
    body: "Friday at the Pineapple.",
    photoAltText: "Two pints beside the window",
    area: "camden",
    venueId: "venue-pineapple",
    visibility: "friends" as const,
    commentPolicy: "friends" as const,
    moderationClaim: "Provider requested a review.",
    moderationState: "needs_review" as const,
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:05:00.000Z",
  };

  it("shows empty only after a successful empty response", async () => {
    await loadAdmin();
    expect(host.textContent).toContain("No Social posts awaiting review");
    expect(host.textContent).not.toContain("Social post moderation is unavailable.");
  });

  it("shows unavailable when the Social queue cannot be read", async () => {
    state.socialUnavailable = true;
    await loadAdmin();
    expect(host.textContent).toContain("Social post moderation is unavailable.");
    expect(host.textContent).not.toContain("No Social posts awaiting review");
  });

  it("shows the exact held revision and its review context even when Pint Drop requests fail", async () => {
    state.pintDropsFail = true;
    state.socialPosts = [heldPost];
    await loadAdmin();
    expect(host.textContent).toContain("@alice");
    expect(host.textContent).not.toContain("Profile:");
    expect(host.textContent).not.toContain("profile-alice");
    expect(host.textContent).toContain("Revision 4");
    expect(host.textContent).toContain("Friday at the Pineapple.");
    expect(host.textContent).toContain("Area: camden");
    expect(host.textContent).toContain("Venue: venue-pineapple");
    expect(host.textContent).toContain("Visibility: Friends");
    expect(host.textContent).toContain("Comments: Friends");
    expect(host.textContent).toContain("State: Needs review");
    expect(host.textContent).toContain("Reason: Provider requested a review.");
    expect(host.querySelector('time[datetime="2026-08-29T12:00:00.000Z"]')).toBeTruthy();
    expect(host.querySelector('time[datetime="2026-08-29T12:05:00.000Z"]')).toBeTruthy();
    const image = host.querySelector(
      'img[src="/api/admin/social-posts/media/22222222-2222-4222-8222-222222222222"]',
    );
    expect(image?.getAttribute("alt")).toBe("Two pints beside the window");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Approve")).toBe(true);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Hide")).toBe(true);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Reject")).toBe(false);
    expect(
      [...host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Load reported drops"),
      ),
    ).toBeTruthy();
  });

  it("hides a post and keeps the row disabled until the decision completes", async () => {
    state.socialPosts = [{ ...heldPost, revision: 0 }];
    let releaseAction = () => {};
    state.socialActionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    await loadAdmin();
    const hide = [...host.querySelectorAll("button")].find((button) => button.textContent === "Hide");
    expect(hide).toBeTruthy();

    await act(async () => {
      hide!.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Hiding…");
    const socialButtons = [...host.querySelectorAll("button")].filter((button) =>
      button.textContent === "Approve" || button.textContent === "Hiding…",
    );
    expect(socialButtons).toHaveLength(2);
    expect(socialButtons.every((button) => button.disabled)).toBe(true);

    await act(async () => {
      releaseAction();
      await state.socialActionGate;
      await Promise.resolve();
    });
    expect(state.socialActionBodies).toEqual([{
      postId: heldPost.postId,
      mediaId: heldPost.mediaId,
      expectedRevision: 0,
      action: "hide",
    }]);
    expect(host.textContent).toContain("Social post hidden.");
    expect(host.textContent).not.toContain("Friday at the Pineapple.");
  });

  it("keeps the held row and shows an error when a decision fails", async () => {
    state.socialPosts = [heldPost];
    state.socialActionStatus = 503;
    await loadAdmin();
    const hide = [...host.querySelectorAll("button")].find((button) => button.textContent === "Hide");
    await act(async () => {
      hide!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Friday at the Pineapple.");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Social post action failed. Try again.",
    );
  });

  it("removes a stale row and tells the moderator to reload after a conflict", async () => {
    state.socialPosts = [heldPost];
    state.socialActionStatus = 409;
    await loadAdmin();
    const hide = [...host.querySelectorAll("button")].find((button) => button.textContent === "Hide");

    await act(async () => {
      hide!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Friday at the Pineapple.");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Post changed. Reload queue.",
    );
  });
});
