// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => createElement("a", { href, ...props }, children),
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
import venueDataset from "../public/data/pint_prices_app_dataset.json";

type CommunityPriceRow = {
  id: string;
  venueId: string;
  submittedAt: number;
  hidden: boolean;
  reportCount: number;
  reportedAt?: number;
  reportReason?: string;
  moderatorNote?: string;
  kind: "price" | "signal";
  drinkCategory?: "beer" | "cider" | "wine" | "spirit" | "soft-drink" | "alcohol-free" | "other";
  priceGbp?: number;
  signalKey?: string;
  signalValue?: string;
};

const reportedPrice: CommunityPriceRow = {
  id: "price-1",
  venueId: "venue-1",
  submittedAt: Date.parse("2026-08-22T18:00:00.000Z"),
  hidden: false,
  reportCount: 2,
  reportedAt: Date.parse("2026-08-23T09:00:00.000Z"),
  reportReason: "Wrong price on the menu",
  kind: "price",
  drinkCategory: "beer",
  priceGbp: 5.5,
};

const hiddenSignal: CommunityPriceRow = {
  id: "signal-1",
  venueId: "venue-2",
  submittedAt: Date.parse("2026-08-21T18:00:00.000Z"),
  hidden: true,
  reportCount: 1,
  reportedAt: Date.parse("2026-08-22T09:00:00.000Z"),
  reportReason: "Access detail is wrong",
  kind: "signal",
  signalKey: "step-free-venue",
  signalValue: "steps",
};

let communityPrices: CommunityPriceRow[];
let communityPriceFailure = false;
let moderationFailure: "json" | "text" | null = null;
let moderationFailureResponse: Response | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let host: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responseFor(input: string, init?: RequestInit): Response | Promise<Response> {
  const method = init?.method ?? "GET";
  const path = new URL(input, "http://localhost").pathname + new URL(input, "http://localhost").search;

  if (path === "/api/admin/session") {
    return method === "POST" ? new Response(null, { status: 200 }) : jsonResponse({ authenticated: true });
  }

  if (path === "/api/admin/community-prices") {
    if (method === "POST") {
      if (moderationFailure) {
        moderationFailureResponse = moderationFailure === "json"
          ? jsonResponse(
              {
                error: "Community observation was hidden, but its trust credit could not be updated. Try again.",
                code: "TRUST_RECONCILIATION_UNAVAILABLE",
                retryable: true,
              },
              503,
            )
          : new Response("Upstream unavailable", {
              status: 503,
              headers: { "content-type": "text/plain" },
            });
        return moderationFailureResponse;
      }
      return jsonResponse({ ok: true });
    }
    if (communityPriceFailure) return jsonResponse({ prices: [], degraded: true });
    return jsonResponse({ prices: communityPrices });
  }

  if (path === "/data/pint_prices_app_dataset.json") {
    return jsonResponse([venueDataset[0]]);
  }

  if (path.startsWith("/api/pint-drops")) return jsonResponse({ drops: [] });
  if (path.startsWith("/api/admin/comments")) return jsonResponse({ comments: [] });
  if (path.startsWith("/api/visit-reports")) return jsonResponse({ reports: [] });
  if (path.startsWith("/api/venue-photos")) return jsonResponse({ photos: [] });
  if (path.startsWith("/api/admin/profile-avatars")) {
    return jsonResponse({ avatars: [], rotationCovers: [] });
  }

  throw new Error(`Unexpected fetch: ${method} ${path}`);
}

function findButton(text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function communityCard(id: string): HTMLElement {
  const card = host.querySelector<HTMLElement>(`[data-community-price-id="${id}"]`);
  if (!card) throw new Error(`Community price card not found: ${id}`);
  return card;
}

async function renderAdmin(): Promise<void> {
  await act(async () => {
    root.render(createElement(AdminClient));
  });
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem("pubmax_admin_token", "test-token");
  communityPrices = [];
  communityPriceFailure = false;
  moderationFailure = null;
  moderationFailureResponse = null;
  fetchMock = vi.fn((input: string, init?: RequestInit) => responseFor(input, init));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("community price moderation queues", () => {
  it("renders reported and hidden observations from the shared queue", async () => {
    communityPrices = [reportedPrice, hiddenSignal];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    expect(host.textContent).toContain("Reported Community Prices");
    expect(host.textContent).toContain("£5.50");
    expect(host.textContent).toContain("Wrong price on the menu");
    expect(host.textContent).toContain("Hidden Community Prices");
    expect(host.textContent).toContain("Entrance: Has steps");
    expect(host.textContent).not.toContain("step-free-venue: steps");
    expect(host.textContent).toContain("Access detail is wrong");
    expect(host.textContent).not.toContain("Review reported prices and venue signals");
    expect(host.textContent).not.toContain("Observation:");
  });

  it("uses the venue dataset name when one is available", async () => {
    communityPrices = [{ ...reportedPrice, venueId: "venue-xjf3n0" }];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    expect(host.textContent).toContain("Arnos Arms");
  });

  it("sends hide and restore actions, then refreshes only the community queue", async () => {
    communityPrices = [reportedPrice];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    communityPrices = [{ ...reportedPrice, hidden: true }];
    await click(findButton("Hide"));

    const hideRequest = fetchMock.mock.calls.find(
      ([input, init]) =>
        input === "/api/admin/community-prices" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(hideRequest?.[1]).toMatchObject({
      body: JSON.stringify({ action: "hide", id: "price-1" }),
    });
    expect(communityCard("price-1").textContent).toContain("Restore");

    communityPrices = [{ ...reportedPrice, hidden: false }];
    await click(findButton("Restore"));

    const moderationRequests = fetchMock.mock.calls.filter(
      ([input, init]) =>
        input === "/api/admin/community-prices" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(moderationRequests[1]?.[1]).toMatchObject({
      body: JSON.stringify({ action: "restore", id: "price-1" }),
    });
    expect(communityCard("price-1").textContent).toContain("Hide");
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          input === "/api/admin/community-prices" &&
          !(init as RequestInit | undefined)?.method,
      ),
    ).toHaveLength(3);
  });

  it("reconciles trust from a reported row without restoring it again", async () => {
    communityPrices = [reportedPrice];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    await click(findButton("Retry trust update"));

    const request = fetchMock.mock.calls.find(
      ([input, init]) =>
        input === "/api/admin/community-prices" &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(request?.[1]).toMatchObject({
      body: JSON.stringify({ action: "reconcile", id: "price-1" }),
    });
    expect(communityCard("price-1").textContent).toContain("Hide");
    expect(host.textContent).toContain("Price trust updated.");
  });

  it("shows loading state while the moderation queue is pending", async () => {
    let resolveQueue!: (response: Response) => void;
    const queuePromise = new Promise<Response>((resolve) => {
      resolveQueue = resolve;
    });
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const path = new URL(input, "http://localhost").pathname;
      if (path === "/api/admin/community-prices" && !init?.method) {
        return queuePromise;
      }
      return responseFor(input, init);
    });

    await renderAdmin();
    const loadButton = findButton("Load reported drops");
    act(() => {
      loadButton.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadButton.textContent).toBe("Loading…");
    expect(loadButton.disabled).toBe(true);
    expect(host.textContent).toContain("Loading community prices…");

    resolveQueue(jsonResponse({ prices: [] }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("shows explicit empty states for both community queues", async () => {
    await renderAdmin();
    await click(findButton("Load reported drops"));

    expect(host.textContent).toContain("No reported community prices");
    expect(host.textContent).toContain("No hidden community prices");
  });

  it("keeps a row visible after a failed hide so an error is non-destructive", async () => {
    communityPrices = [reportedPrice];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    moderationFailure = "json";
    await click(findButton("Hide"));

    expect(communityCard("price-1").textContent).toContain("£5.50");
    expect(host.textContent).toContain(
      "Community observation was hidden, but its trust credit could not be updated. Try again.",
    );
    expect(
      [...host.querySelectorAll('[role="alert"]')].some((alert) =>
        alert.textContent?.includes(
          "Community observation was hidden, but its trust credit could not be updated. Try again.",
        ),
      ),
    ).toBe(true);
    expect(communityCard("price-1").textContent).toContain("Hide");

    moderationFailure = null;
    communityPrices = [{ ...reportedPrice, hidden: true }];
    await click(findButton("Hide"));

    expect(communityCard("price-1").textContent).toContain("Restore");
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          input === "/api/admin/community-prices" &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(2);
  });

  it("cancels a non-JSON moderation failure body", async () => {
    communityPrices = [reportedPrice];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    moderationFailure = "text";
    await click(findButton("Hide"));

    expect(moderationFailureResponse?.bodyUsed).toBe(true);
    expect(
      [...host.querySelectorAll('[role="alert"]')].some((alert) =>
        alert.textContent?.includes("Action failed. Try again."),
      ),
    ).toBe(true);
    expect(communityCard("price-1").textContent).toContain("Hide");
  });

  it("reconciles trust from a hidden row without hiding it again", async () => {
    communityPrices = [{ ...reportedPrice, hidden: true }];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    await click(findButton("Retry trust update"));

    const request = fetchMock.mock.calls.find(
      ([input, init]) =>
        input === "/api/admin/community-prices" &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(request?.[1]).toMatchObject({
      body: JSON.stringify({ action: "reconcile", id: "price-1" }),
    });
    expect(communityCard("price-1").textContent).toContain("Restore");
    expect(host.textContent).toContain("Price trust updated.");
  });

  it("keeps the previous queues when a later refresh cannot load them", async () => {
    communityPrices = [reportedPrice];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    communityPriceFailure = true;
    await click(findButton("Load reported drops"));

    expect(communityCard("price-1").textContent).toContain("£5.50");
    expect(host.textContent).toContain("Could not load community prices.");
  });

  it("moves a successfully hidden row before a refresh failure reports stale data", async () => {
    communityPrices = [reportedPrice];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    communityPriceFailure = true;
    await click(findButton("Hide"));

    expect(communityCard("price-1").textContent).toContain("Restore");
    expect(host.textContent).toContain("Refresh unavailable. Reload to confirm.");
  });

  it("disables every community decision while an action refresh is pending", async () => {
    const secondPrice = { ...reportedPrice, id: "price-2", venueId: "venue-2" };
    communityPrices = [reportedPrice, secondPrice];
    await renderAdmin();
    await click(findButton("Load reported drops"));

    let resolveRefresh!: (response: Response) => void;
    let queueReads = 0;
    const refresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (input === "/api/admin/community-prices" && !init?.method) {
        queueReads += 1;
        if (queueReads === 1) return refresh;
      }
      return responseFor(input, init);
    });

    communityPrices = [{ ...reportedPrice, hidden: true }, secondPrice];
    const action = click(
      communityCard("price-1").querySelector<HTMLButtonElement>("button")!,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(communityCard("price-2").querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );

    resolveRefresh(jsonResponse({ prices: communityPrices }));
    await action;
  });
});
