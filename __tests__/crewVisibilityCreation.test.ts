// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  identityResolved: true,
  user: { id: "account-a" } as { id: string } | null,
}));
const authedActionFetch = vi.hoisted(() => vi.fn());

const PLAN_ID = "60000000-0000-4000-8000-000000000001";
const CREW_ID = "50000000-0000-4000-8000-000000000001";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));

import CrewsPanel from "@/components/social/CrewsPanel";
import { CREW_VISIBILITY_LABEL } from "@/lib/socialCrewsUi";
import { SOCIAL_CREW_VISIBILITIES } from "@/lib/socialCrew";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  authState.identityResolved = true;
  authState.user = { id: "account-a" };
  authedActionFetch.mockReset();
  authedActionFetch.mockResolvedValue(
    new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
});

describe("crew visibility creation", () => {
  it("offers every supported visibility and defaults to invite only", async () => {
    await act(async () => {
      root.render(createElement(CrewsPanel, { viewerHandle: "alice" }));
    });

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start a crew",
    );
    expect(startButton).toBeTruthy();

    await act(async () => startButton?.click());

    const radios = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="visibility"]'),
    );
    expect(radios.map((radio) => radio.value)).toEqual([...SOCIAL_CREW_VISIBILITIES]);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual([
      "private",
    ]);
    for (const visibility of SOCIAL_CREW_VISIBILITIES) {
      expect(container.textContent).toContain(CREW_VISIBILITY_LABEL[visibility]);
    }
  });

  it("sends selected open visibility after the valid first pub is chosen", async () => {
    vi.useFakeTimers();
    authedActionFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === "/api/social/crews" && !options?.method) {
        return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      }
      if (url.startsWith("/api/social/venues")) {
        return new Response(
          JSON.stringify({ venues: [{ id: "venue-a", name: "The First", borough: "Camden" }] }),
          { status: 200 },
        );
      }
      if (url === "/api/plans") {
        return new Response(
          JSON.stringify({ plan: { plan: { id: PLAN_ID } }, memberToken: "plan-token" }),
          { status: 201 },
        );
      }
      if (url === "/api/social/crews" && options?.method === "POST") {
        return new Response(JSON.stringify({ code: "created", crewId: CREW_ID }), {
          status: 201,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await act(async () => {
      root.render(createElement(CrewsPanel, { viewerHandle: "alice" }));
    });
    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start a crew",
    );
    await act(async () => startButton?.click());

    const name = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(name).toBeTruthy();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).toBeTruthy();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(name, "Friday in Camden");
      name!.dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(search, "First");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(220);
      await Promise.resolve();
      await Promise.resolve();
    });
    const venueButton = container.querySelector<HTMLButtonElement>(".crews__venueOption");
    expect(venueButton).toBeTruthy();
    await act(async () => venueButton?.click());

    const openRadio = container.querySelector<HTMLInputElement>('input[value="open"]');
    expect(openRadio).toBeTruthy();
    await act(async () => openRadio?.click());
    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start the crew",
    );
    await act(async () => submitButton?.click());

    const crewCreateCall = authedActionFetch.mock.calls.find(
      ([url, options]) => url === "/api/social/crews" && options?.method === "POST",
    );
    expect(crewCreateCall).toBeTruthy();
    expect(JSON.parse(crewCreateCall?.[1].body as string)).toMatchObject({
      planId: PLAN_ID,
      visibility: "open",
    });
    vi.useRealTimers();
  });
});
