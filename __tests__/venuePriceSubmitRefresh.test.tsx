// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submit = vi.hoisted(() => vi.fn());

vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { accessToken: string }) => unknown) => {
      await action({ accessToken: "test-access-token" });
    },
    contributionGateDialog: null,
  }),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/map/PriceContributionImpact", () => ({
  default: () => null,
}));

import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";

const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map(),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map(),
  loadVenue: vi.fn(),
  submit,
  submitVenueSignal: vi.fn(),
  submitting: false,
  reportPrice: vi.fn(),
  reportedIds: new Set<string>(),
} as unknown as CommunityPricesState;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  submit.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Pint Drop sheet refresh", () => {
  it("notifies the open venue after the price write succeeds", async () => {
    submit.mockResolvedValue({
      ok: true,
      attribution: { status: "credited", handle: "alice" },
      price: null,
    });
    const onLogged = vi.fn();

    await act(async () => {
      root.render(
        createElement(VenuePriceSubmit, {
          venueId: "venue-1",
          venueName: "The Test Arms",
          communityPrices,
          onLogged,
        }),
      );
    });

    const quickPrice = container.querySelector<HTMLButtonElement>(".vpsubQuickChip");
    if (!quickPrice) throw new Error("quick price button did not render");
    await act(async () => {
      quickPrice.click();
    });

    const logButton = container.querySelector<HTMLButtonElement>(".vpsubLog");
    if (!logButton) throw new Error("Log it button did not render");
    await act(async () => {
      logButton.click();
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ venueId: "venue-1" }),
      { accessToken: "test-access-token" },
    );
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(onLogged).toHaveBeenCalledWith("venue-1");
  });
});
