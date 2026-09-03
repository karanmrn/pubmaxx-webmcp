// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const planSession = vi.hoisted(() => ({
  role: "host" as "host" | "guest" | null,
  restorePlanCapability: vi.fn(),
}));

const state = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  session: {
    access_token: "account-token",
    user: { id: "11111111-1111-4111-8111-111111111111" },
  } as { access_token: string; user: { id: string } } | null,
  identityResolved: true,
  accountBoundFetch: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: state.user,
    session: state.session,
    identityResolved: state.identityResolved,
  }),
}));
vi.mock("@/lib/accountBoundFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accountBoundFetch")>()),
  accountBoundFetch: state.accountBoundFetch,
}));
vi.mock("@/lib/activePlan", () => ({
  markActivePlan: vi.fn(),
  setActivePlanRole: vi.fn(),
}));
vi.mock("@/lib/authRedirect", () => ({
  subscribeToAuthFragmentRestored: vi.fn(() => () => {}),
}));
vi.mock("@/lib/crewRealtime", () => ({
  subscribeToPlanCrew: vi.fn(() => () => {}),
}));
vi.mock("@/lib/planSessionCapability", () => ({
  parsePlanCapabilitySnapshot: () => ({
    token: "",
    collaborationAuthorized: true,
    role: planSession.role,
  }),
  planCapabilityEvent: (id: string) => `pubmax:plan-capability:${id}`,
  readPlanCapabilitySnapshot: () => planSession.role ? `|1|${planSession.role}` : "|0|",
  restorePlanCapability: planSession.restorePlanCapability,
  writePlanCapability: vi.fn(),
}));

import ActivePlanMarker from "@/components/plan/ActivePlanMarker";
import PlanCrew from "@/components/plan/PlanCrew";
import { setProviderIdentity } from "@/lib/authProviderRevision";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let rootUnmounted = false;

beforeEach(() => {
  planSession.role = "host";
  planSession.restorePlanCapability.mockReset().mockResolvedValue({ role: "host" });
  state.user = { id: "11111111-1111-4111-8111-111111111111" };
  state.session = {
    access_token: "account-token",
    user: { id: "11111111-1111-4111-8111-111111111111" },
  };
  state.identityResolved = true;
  state.accountBoundFetch.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ claimed: true, role: "host" })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  rootUnmounted = false;
});

afterEach(async () => {
  if (!rootUnmounted) await act(async () => root.unmount());
  setProviderIdentity("supabase", null);
  container.remove();
  vi.clearAllMocks();
});

describe("active Plan account claim", () => {
  it("claims the restored guest Plan after account identity resolves", async () => {
    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(state.accountBoundFetch).toHaveBeenCalledWith(
      {
        userId: "11111111-1111-4111-8111-111111111111",
        accessToken: "account-token",
      },
      "/api/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/session",
      { method: "PUT", signal: expect.any(AbortSignal) },
    );
  });

  it("aborts an in-flight claim when the provider identity changes", async () => {
    setProviderIdentity("supabase", "account-a");
    let actionSignal: AbortSignal | undefined;
    state.accountBoundFetch.mockImplementationOnce((_auth, _input, init) => {
      actionSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    });

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "12121212-1212-4121-8121-121212121212",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(actionSignal).toBeInstanceOf(AbortSignal);
    setProviderIdentity("supabase", "account-b");
    await act(async () => {
      await Promise.resolve();
    });

    expect(actionSignal?.aborted).toBe(true);
  });

  it("does not claim while signed out", async () => {
    state.user = null;
    state.session = null;

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(state.accountBoundFetch).not.toHaveBeenCalled();
  });

  it("does not wait for canonical profile resolution", async () => {
    state.identityResolved = false;

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(state.accountBoundFetch).toHaveBeenCalledOnce();
  });

  it("restores capability on the auth-ready transition", async () => {
    state.identityResolved = false;
    planSession.role = null;

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "56565656-5656-4565-8565-565656565656",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(planSession.restorePlanCapability).not.toHaveBeenCalled();

    state.identityResolved = true;
    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "56565656-5656-4565-8565-565656565656",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(planSession.restorePlanCapability).toHaveBeenCalledOnce();
  });

  it("restores PlanCrew capability on the auth-ready transition", async () => {
    state.identityResolved = false;
    planSession.role = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await act(async () => {
      root.render(createElement(PlanCrew, {
        planId: "67676767-6767-4676-8676-676767676767",
        hostName: "Priya",
      }));
      await Promise.resolve();
    });

    expect(planSession.restorePlanCapability).not.toHaveBeenCalled();

    state.identityResolved = true;
    await act(async () => {
      root.render(createElement(PlanCrew, {
        planId: "67676767-6767-4676-8676-676767676767",
        hostName: "Priya",
      }));
      await Promise.resolve();
    });

    expect(planSession.restorePlanCapability).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it("retries one transient claim failure", async () => {
    vi.useFakeTimers();
    state.accountBoundFetch
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });
    expect(state.accountBoundFetch).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    expect(state.accountBoundFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("discards a transient failure body before retrying", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    state.accountBoundFetch
      .mockResolvedValueOnce(new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"error":"busy"}'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 503 },
      ))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(cancelled).toBe(true);
    vi.useRealTimers();
  });

  it("discards a successful claim body", async () => {
    let cancelled = false;
    state.accountBoundFetch.mockResolvedValueOnce(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"claimed":true}'));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    ));

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "abababab-abab-4aba-8aba-abababababab",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(cancelled).toBe(true);
  });

  it("does not schedule a retry after unmount while the first claim is pending", async () => {
    vi.useFakeTimers();
    let resolveClaim: ((response: Response) => void) | undefined;
    state.accountBoundFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveClaim = resolve;
    }));

    await act(async () => {
      root.render(createElement(ActivePlanMarker, {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        startTime: "2026-08-27T19:00:00.000Z",
      }));
      await Promise.resolve();
    });
    expect(state.accountBoundFetch).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    rootUnmounted = true;
    await act(async () => {
      resolveClaim?.(new Response(null, { status: 503 }));
      await Promise.resolve();
    });

    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
