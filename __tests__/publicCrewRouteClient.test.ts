// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CREW_A = "50000000-0000-4000-8000-000000000001";
const CREW_B = "50000000-0000-4000-8000-000000000002";

const responseBody = vi.hoisted(() => ({
  discardBody: vi.fn(),
}));

const state = vi.hoisted(() => ({
  identityResolved: true,
  provider: "clerk" as "clerk" | "supabase" | "signed-out",
  providerUserId: "clerk-actor-a" as string | null,
  providerAuthState: "authenticated" as
    | "authenticated"
    | "signed-out"
    | "unresolved"
    | "unavailable",
  socialLaunchEnabled: true,
  accountRevision: 1,
  privateState: "none" as "none" | "pending" | "member",
  privateStatus: 200,
  privateResponses: "ready" as "ready" | "deferred",
  publicStatus: 200,
  publicCalls: [] as string[],
  publicResponses: new Map<string, "ready" | "deferred">(),
  deferredPublic: new Map<string, Array<(response: Response) => void>>(),
  deferredJoin: [] as Array<(response: Response) => void>,
  deferredPrivate: [] as Array<(response: Response) => void>,
  actionCalls: [] as string[],
}));

function preview(crewId: string, title = crewId === CREW_A ? "Friday in Camden" : "Saturday in Soho") {
  return {
    kind: "public" as const,
    crewId,
    title,
    hostHandle: "host",
    startsAt: "2026-08-23T18:30:00.000Z",
    meetingPoint: {
      kind: "venue" as const,
      name: crewId === CREW_A ? "Camden Arms" : "Soho Arms",
      lat: 51.541,
      lng: -0.142,
    },
  };
}

function privatePreview(crewId: string) {
  return {
    kind: "preview",
    title: preview(crewId).title,
    phase: "planning",
    nightArea: "london",
    startsAt: "2026-08-23T18:30:00.000Z",
    joinRequestState: state.privateState === "pending" ? "pending" : "none",
  };
}

function privateMember(crewId: string) {
  return {
    kind: "member",
    crewId,
    title: preview(crewId).title,
    visibility: "open",
    phase: "planning",
    nightArea: "london",
    startsAt: "2026-08-23T18:30:00.000Z",
    authorityRevision: 1,
    viewer: {
      memberId: "30000000-0000-4000-8000-000000000001",
      role: "member",
    },
    owner: {
      memberId: "30000000-0000-4000-8000-000000000002",
      handle: "host",
    },
    members: [],
  };
}

function publicResponse(crewId: string): Response {
  if (state.publicStatus !== 200) {
    const status = state.publicStatus;
    return new Response(JSON.stringify({ code: "not_found" }), { status });
  }
  return Response.json(preview(crewId));
}

function actionResponse(crewId: string): Response {
  if (state.privateStatus !== 200) {
    const status = state.privateStatus;
    return new Response(JSON.stringify({ code: "not_found" }), { status });
  }
  if (state.privateState === "member") return Response.json(privateMember(crewId));
  return Response.json(privatePreview(crewId));
}

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    createElement("a", { href: String(href), ...props }, children),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    // Clerk-backed Social identity has no Supabase session. The component
    // must use the provider-neutral revision seam for both providers.
    identityResolved: state.identityResolved,
    providerAuthState: state.providerAuthState,
    accountRevision: state.accountRevision,
    session:
      state.provider === "supabase" && state.providerUserId
        ? { user: { id: state.providerUserId } }
        : null,
    user:
      state.provider === "supabase" && state.providerUserId
        ? { id: state.providerUserId }
        : null,
  }),
}));

vi.mock("@/lib/responseBody", () => responseBody);

vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => state.socialLaunchEnabled,
}));

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));

vi.mock("@/app/social/crews/[crewId]/CrewDetailClient", () => ({
  default: ({ crewId }: { crewId: string }) =>
    createElement("div", { "data-testid": "crew-detail" }, `Member detail ${crewId}`),
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    state.actionCalls.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST" && url.endsWith("/join-requests")) {
      return new Promise<Response>((resolve) => state.deferredJoin.push(resolve));
    }
    if (state.privateResponses === "deferred") {
      return new Promise<Response>((resolve) => state.deferredPrivate.push(resolve));
    }
    const crewId = url.includes(CREW_B) ? CREW_B : CREW_A;
    return Promise.resolve(actionResponse(crewId));
  }),
}));

import PublicCrewRouteClient from "@/components/social/PublicCrewRouteClient";

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}

beforeEach(() => {
  state.identityResolved = true;
  state.provider = "clerk";
  state.providerUserId = "clerk-actor-a";
  state.providerAuthState = "authenticated";
  state.accountRevision = 1;
  state.privateState = "none";
  state.privateStatus = 200;
  state.privateResponses = "ready";
  state.publicStatus = 200;
  state.socialLaunchEnabled = true;
  state.publicCalls = [];
  state.publicResponses = new Map([
    [CREW_A, "ready"],
    [CREW_B, "ready"],
  ]);
  state.deferredPublic = new Map();
  state.deferredJoin = [];
  state.deferredPrivate = [];
  state.actionCalls = [];
  responseBody.discardBody.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      state.publicCalls.push(url);
      const crewId = url.includes(CREW_B) ? CREW_B : CREW_A;
      if (state.publicResponses.get(crewId) === "deferred") {
        return new Promise<Response>((resolve) => {
          const pending = state.deferredPublic.get(crewId) ?? [];
          pending.push(resolve);
          state.deferredPublic.set(crewId, pending);
        });
      }
      return Promise.resolve(publicResponse(crewId));
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("PublicCrewRouteClient identity and crew boundaries", () => {
  it("renders static Social preview and skips crew reads during rollback", async () => {
    state.socialLaunchEnabled = false;
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(state.publicCalls).toEqual([]);
    expect(state.actionCalls).toEqual([]);
    expect(container.textContent).toContain(
      "Social preview is invite-only for now. It opens more widely soon.",
    );
    expect(container.textContent).not.toContain("Could not load this crew.");
    expect(container.textContent).not.toContain("Ask to join");
  });

  it("loads protected Social state when identity is resolved without a Supabase session", async () => {
    state.privateState = "member";
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(state.actionCalls).toContain(`GET /api/social/crews/${CREW_A}`);
    expect(container.querySelector('[data-testid="crew-detail"]')).not.toBeNull();
  });

  it("routes an authenticated invitation through CrewDetailClient before public preview", async () => {
    await act(async () => {
      root.render(
        createElement(PublicCrewRouteClient, {
          crewId: CREW_A,
          invitationId: "60000000-0000-4000-8000-000000000001",
        }),
      );
    });
    await settle();

    expect(container.querySelector('[data-testid="crew-detail"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Ask to join");
  });

  it("holds an invitation preview and action while its private read resolves", async () => {
    state.privateResponses = "deferred";
    await act(async () => {
      root.render(
        createElement(PublicCrewRouteClient, {
          crewId: CREW_A,
          invitationId: "60000000-0000-4000-8000-000000000001",
        }),
      );
    });
    await settle();

    expect(state.deferredPrivate).toHaveLength(1);
    expect(container.textContent).not.toContain("Ask to join");
    expect(container.textContent).not.toContain("Join the crew");

    await act(async () => state.deferredPrivate[0]?.(actionResponse(CREW_A)));
    await settle();
    expect(container.querySelector('[data-testid="crew-detail"]')).not.toBeNull();
  });

  it("holds an authenticated public preview while its private read resolves", async () => {
    state.privateResponses = "deferred";
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(state.deferredPrivate).toHaveLength(1);
    expect(container.textContent).not.toContain("Ask to join");
  });

  it("does not request protected crew state for a truly signed-out reader", async () => {
    state.provider = "signed-out";
    state.providerUserId = null;
    state.providerAuthState = "signed-out";
    state.accountRevision = 2;
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(state.actionCalls).not.toContain(`GET /api/social/crews/${CREW_A}`);
    expect(container.textContent).toContain("Ask to join");
  });

  it("keeps an unavailable reader neutral", async () => {
    state.provider = "signed-out";
    state.providerUserId = null;
    state.providerAuthState = "unavailable";
    state.accountRevision = 2;
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(state.actionCalls).not.toContain(`GET /api/social/crews/${CREW_A}`);
    expect(container.textContent).not.toContain("Ask to join");
  });

  it("clears private join state when provider account revision changes", async () => {
    state.privateState = "pending";
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();
    expect(container.textContent).toContain("Request sent. The host decides.");

    // Clerk account switch: both accounts have no Supabase User ID. The
    // provider-neutral revision is the real account boundary.
    state.providerUserId = "clerk-actor-b";
    state.accountRevision = 2;
    state.privateState = "none";
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(container.textContent).not.toContain("Request sent. The host decides.");
  });

  it("keeps a Supabase provider identity in the same account revision seam", async () => {
    state.provider = "supabase";
    state.providerUserId = "supabase-actor-a";
    state.accountRevision = 3;
    state.privateState = "member";

    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(state.actionCalls).toContain(`GET /api/social/crews/${CREW_A}`);
    expect(container.querySelector('[data-testid="crew-detail"]')).not.toBeNull();
  });

  it("discards public and protected 404 bodies", async () => {
    state.publicStatus = 404;
    state.privateStatus = 404;

    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(responseBody.discardBody).toHaveBeenCalledTimes(2);
  });

  it("discards every non-ok public and protected response body", async () => {
    state.publicStatus = 503;
    state.privateStatus = 503;

    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(responseBody.discardBody).toHaveBeenCalledTimes(2);
  });

  it("does not retain the previous crew preview while the next crew loads", async () => {
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();
    expect(container.textContent).toContain("Friday in Camden");

    state.publicResponses.set(CREW_B, "deferred");
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_B, invitationId: null }));
    });

    expect(container.textContent).not.toContain("Friday in Camden");
    expect(container.textContent).not.toContain("Camden Arms");
  });

  it("ignores a delayed join response after navigating to another crew", async () => {
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    const ask = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Ask to join",
    );
    expect(ask).not.toBeUndefined();
    await act(async () => ask?.click());
    expect(state.deferredJoin).toHaveLength(1);

    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_B, invitationId: null }));
    });
    await settle();
    await act(async () => state.deferredJoin[0]?.(Response.json({ code: "requested" })));
    await settle();

    expect(container.textContent).toContain("Saturday in Soho");
    expect(container.textContent).not.toContain("Request sent. The host decides.");
  });
});
