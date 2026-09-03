// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import WebMcpNightBoard from "@/components/webmcp/WebMcpNightBoard";

let container: HTMLDivElement;
let root: Root;

function generatedVictoriaRoute() {
  return {
    grounded: true,
    operationKey: "webmcp-default-demo",
    groundingProof: "verified-demo-proof",
    inferredContext: { nightArea: "victoria", stopCount: 3 },
    routeTotals: { stopCount: 3, estimatedWalkingMinutes: 5 },
    planningConfidence: {
      level: "medium",
      warnings: ["Check current opening hours before relying on this route."],
      provenance: [{ kind: "venue_dataset", label: "PUBMAXX Venue Dataset" }],
    },
    stops: [
      { venueId: "victoria-1", venueName: "Market Halls, Victoria", alternatives: [] },
      { venueId: "victoria-2", venueName: "The Willow Walk", alternatives: [] },
      { venueId: "victoria-3", venueName: "Victoria Station", alternatives: [] },
    ],
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("WebMCP Agent Night Board", () => {
  it("submits the untouched default request and publishes Revision 1", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(generatedVictoriaRoute()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(WebMcpNightBoard));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector<HTMLTextAreaElement>("#webmcp-request")?.value)
      .toBe("Three pubs in Victoria");
    expect(container.querySelector<HTMLInputElement>("#webmcp-search")?.value).toBe("Victoria");
    expect(container.textContent).toContain("Manual board ready");
    const draftButton = container.querySelector<HTMLButtonElement>(".webmcpDraft button");
    expect(draftButton).not.toBeNull();
    const draftForm = container.querySelector<HTMLFormElement>(".webmcpDraft");
    expect(draftForm).not.toBeNull();

    await act(async () => {
      draftForm!.requestSubmit(draftButton!);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/plans/generate");
    expect(JSON.parse(String(init?.body))).toEqual({ query: "Three pubs in Victoria" });
    expect(container.textContent).toContain("Revision 1");
    expect(container.textContent).toContain("Market Halls, Victoria");
  });
});
