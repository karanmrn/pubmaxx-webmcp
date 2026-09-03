// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: { identityResolved: true, user: null } as {
    identityResolved: boolean;
    user: object | null;
  },
}));
const authedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/lib/authedFetch", () => ({ authedFetch }));

import WantedPlanChips from "@/components/wanted/WantedPlanChips";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  authState.current = { identityResolved: true, user: null };
  authedFetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Wanted plan chips authentication", () => {
  it("does not request a private Wanted list for a signed-out planner", async () => {
    await act(async () => {
      root.render(createElement(WantedPlanChips, { onPick: vi.fn() }));
    });

    expect(authedFetch).not.toHaveBeenCalled();
  });

  it("hides loaded private Wanteds immediately after sign-out", async () => {
    authState.current = { identityResolved: true, user: { id: "account-a" } };
    authedFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          wanteds: [
            {
              id: "wanted-a",
              status: "open",
              venueKind: "pub",
              venueName: "Account A Pub",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await act(async () => {
      root.render(createElement(WantedPlanChips, { onPick: vi.fn() }));
    });
    expect(container.textContent).toContain("Account A Pub");

    authState.current = { identityResolved: true, user: null };
    await act(async () => {
      root.render(createElement(WantedPlanChips, { onPick: vi.fn() }));
    });

    expect(container.textContent).not.toContain("Account A Pub");
  });

  it("hides the prior account's Wanteds while the next account loads", async () => {
    authState.current = { identityResolved: true, user: { id: "account-a" } };
    authedFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            wanteds: [
              {
                id: "wanted-a",
                status: "open",
                venueKind: "pub",
                venueName: "Account A Pub",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    await act(async () => {
      root.render(createElement(WantedPlanChips, { onPick: vi.fn() }));
    });
    expect(container.textContent).toContain("Account A Pub");

    authState.current = { identityResolved: true, user: { id: "account-b" } };
    await act(async () => {
      root.render(createElement(WantedPlanChips, { onPick: vi.fn() }));
    });

    expect(container.textContent).not.toContain("Account A Pub");
  });
});
